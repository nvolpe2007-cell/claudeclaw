"""BTC direction arbitrage: bet on BTC above/below $X markets when our
log-normal price model disagrees with Polymarket by more than MIN_EDGE cents.

Strategy:
  1. Fetch live BTC/USDT price from Binance every scan cycle.
  2. Scan Polymarket for active BTC "above/below $X" markets.
  3. For each market: extract threshold + time remaining, compute model prob
     using log-normal distribution with time-scaled volatility.
  4. Apply momentum adjustment from recent 1-min candles (±5% max).
  5. Compute Kelly fraction (0.25x fractional Kelly).
  6. Enter when edge > direction_min_edge_cents AND minutes_left in [1, max].

Edge: edge = (model_prob - market_price) * 100  (in cents)
  > 0 → BUY YES (market underestimates prob)
  < 0 → SELL YES (market overestimates prob)
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from bot.btc_price import BtcPriceFeed, BtcSnapshot
    from bot.client import PolyClient
    from bot.config import Config
    from bot.notifications import Notifier
    from bot.risk import RiskManager

logger = logging.getLogger(__name__)

# BTC annualized log-vol ≈ 70-80%. Per-minute sigma:
#   0.75 / sqrt(525_600 minutes/year) ≈ 0.001034
_BTC_VOL_PER_MINUTE = 0.001034

# Patterns to extract dollar threshold from question text
_THRESHOLD_RE = re.compile(
    r"\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*[kK]?\b"
)

_DIRECTION_ABOVE = frozenset(["above", "higher", "over", "exceed", "surpass", ">"])
_DIRECTION_BELOW = frozenset(["below", "lower", "under", "drop", "fall", "<"])


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DirectionOpportunity:
    token_id: str
    question: str
    condition_id: str
    side: str             # "BUY" or "SELL"
    market_price: float   # current YES token price (0–1)
    model_prob: float     # our probability estimate (0–1)
    edge_cents: float     # (model_prob - market_price) * 100
    kelly_fraction: float # fractional Kelly (already 0.25x)
    btc_price: float      # BTC spot at evaluation time
    threshold: float      # the $ level in the question
    minutes_left: float   # estimated minutes until market resolves


@dataclass
class DirectionPosition:
    token_id: str
    question: str
    side: str
    entry_price: float
    size: float           # token quantity
    order_id: str
    opened_at: float
    threshold: float
    btc_at_entry: float


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def _normal_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2))


def _prob_above(btc: float, threshold: float, sigma: float) -> float:
    """Log-normal probability BTC ends above threshold given current price."""
    if sigma <= 0 or btc <= 0 or threshold <= 0:
        return 0.5
    log_ret = math.log(threshold / btc)
    z = log_ret / sigma  # zero-drift assumption for short windows
    return 1.0 - _normal_cdf(z)


def _momentum_score(candles) -> float:
    """Returns value in [-1, 1]: +1 = all 5 candles green, -1 = all red."""
    if len(candles) < 5:
        return 0.0
    greens = sum(1 for c in candles[-5:] if c.close > c.open)
    return (greens - 2.5) / 2.5


def _kelly(p: float, price: float) -> float:
    """Fractional Kelly (0.25x). p = win probability, price = odds price."""
    price = max(0.01, min(0.99, price))
    b = (1.0 / price) - 1.0
    q = 1.0 - p
    raw = (p * b - q) / b if b > 0 else 0.0
    return max(0.0, raw * 0.25)


# ---------------------------------------------------------------------------
# ISO date parsing (stdlib only — no dateutil)
# ---------------------------------------------------------------------------

def _parse_iso(s: str) -> Optional[datetime]:
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    # Handle fractional seconds with more than 6 digits
    try:
        s = re.sub(r"(\.\d{6})\d+", r"\1", s)
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _minutes_until(end_date_iso: str) -> float:
    dt = _parse_iso(end_date_iso)
    if dt is None:
        return 9999.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    remaining = (dt - datetime.now(timezone.utc)).total_seconds() / 60.0
    return remaining


# ---------------------------------------------------------------------------
# Threshold / direction extraction
# ---------------------------------------------------------------------------

def _extract_threshold(question: str) -> Optional[float]:
    m = _THRESHOLD_RE.search(question)
    if not m:
        return None
    raw = m.group(1).replace(",", "")
    val = float(raw)
    # Check for 'k' suffix immediately after the number
    end = m.end()
    if end < len(question) and question[end].lower() == "k":
        val *= 1000.0
    return val


def _extract_direction(question: str) -> Optional[str]:
    q = question.lower()
    if any(kw in q for kw in _DIRECTION_ABOVE):
        return "above"
    if any(kw in q for kw in _DIRECTION_BELOW):
        return "below"
    return None


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

_END_CURSOR = "LTE="


class BtcDirectionScanner:
    """Scans Polymarket for BTC directional markets and scores each against our model."""

    def __init__(self, client: PolyClient, price_feed: BtcPriceFeed, config: Config) -> None:
        self._client = client
        self._feed = price_feed
        self._config = config

    async def scan(self) -> list[DirectionOpportunity]:
        snap = self._feed.latest()
        if snap is None:
            return []

        markets = await self._fetch_markets()
        opps: list[DirectionOpportunity] = []
        for m in markets:
            opp = self._evaluate(m, snap)
            if opp:
                opps.append(opp)

        opps.sort(key=lambda o: abs(o.edge_cents), reverse=True)
        logger.info(
            "Direction scan: %d BTC directional markets → %d opportunities (BTC=$%.0f)",
            len(markets), len(opps), snap.price,
        )
        return opps

    async def _fetch_markets(self) -> list[dict]:
        all_markets: list[dict] = []
        cursor = ""
        while True:
            try:
                page = await self._client.get_markets(next_cursor=cursor)
            except Exception as exc:
                logger.error("Direction market fetch error: %s", exc)
                break
            data = page.get("data", []) if isinstance(page, dict) else []
            all_markets.extend(data)
            nc = page.get("next_cursor", _END_CURSOR) if isinstance(page, dict) else _END_CURSOR
            if nc == _END_CURSOR or not nc:
                break
            cursor = nc
        return [m for m in all_markets if self._is_direction_market(m)]

    def _is_direction_market(self, market: dict) -> bool:
        if not (market.get("active") and not market.get("closed") and not market.get("archived")):
            return False
        if len(market.get("tokens", [])) != 2:
            return False
        q = (market.get("question") or "").lower()
        if not any(kw in q for kw in ("btc", "bitcoin")):
            return False
        if not any(kw in q for kw in ("above", "below", "higher", "lower", "over", "under")):
            return False
        return True

    def _evaluate(self, market: dict, snap: BtcSnapshot) -> Optional[DirectionOpportunity]:
        tokens = market.get("tokens", [])
        yes_tok = next((t for t in tokens if t.get("outcome", "").upper() == "YES"), None)
        if not yes_tok:
            return None

        token_id = yes_tok.get("token_id", "")
        try:
            market_price = float(yes_tok.get("price") or 0.5)
        except (TypeError, ValueError):
            return None

        # Skip extreme prices — no edge computable
        if market_price < 0.03 or market_price > 0.97:
            return None

        question = market.get("question", "")
        threshold = _extract_threshold(question)
        direction = _extract_direction(question)
        if threshold is None or direction is None:
            return None

        end_date = market.get("end_date_iso") or market.get("end_date") or ""
        minutes_left = _minutes_until(end_date)
        if minutes_left < 1.0:
            return None

        min_edge = self._config.direction_min_edge_cents
        max_minutes = self._config.direction_max_minutes

        if minutes_left > max_minutes:
            return None

        # Time-scaled volatility
        sigma = _BTC_VOL_PER_MINUTE * math.sqrt(minutes_left)

        raw_prob = _prob_above(snap.price, threshold, sigma)
        if direction == "below":
            raw_prob = 1.0 - raw_prob

        # Momentum nudge ±5%
        momentum = _momentum_score(snap.candles_1m)
        nudge = momentum * 0.05
        if direction == "above":
            model_prob = min(0.97, max(0.03, raw_prob + nudge))
        else:
            model_prob = min(0.97, max(0.03, raw_prob - nudge))

        edge_cents = (model_prob - market_price) * 100

        if abs(edge_cents) < min_edge:
            return None

        # Side and Kelly
        if edge_cents > 0:
            side = "BUY"
            kf = _kelly(model_prob, market_price)
        else:
            side = "SELL"
            kf = _kelly(1.0 - model_prob, 1.0 - market_price)

        return DirectionOpportunity(
            token_id=token_id,
            question=question,
            condition_id=market.get("condition_id", ""),
            side=side,
            market_price=market_price,
            model_prob=model_prob,
            edge_cents=edge_cents,
            kelly_fraction=kf,
            btc_price=snap.price,
            threshold=threshold,
            minutes_left=minutes_left,
        )


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class DirectionExecutor:
    """Places and tracks BTC direction bets."""

    def __init__(
        self,
        client: PolyClient,
        config: Config,
        risk: RiskManager,
        notifier: Notifier,
    ) -> None:
        self._client = client
        self._config = config
        self._risk = risk
        self._notifier = notifier
        self.positions: dict[str, DirectionPosition] = {}
        self.trade_count: int = 0

    async def process(self, opp: DirectionOpportunity) -> None:
        if opp.token_id in self.positions:
            return
        if opp.minutes_left < 1.0 or opp.minutes_left > self._config.direction_max_minutes:
            return
        if not self._risk.can_enter(opp.token_id, self._config.order_size_usdc):
            return
        if len(self.positions) >= self._config.max_concurrent_positions:
            return

        # Kelly-sized order, capped at config order_size_usdc
        kelly_usdc = self._config.order_size_usdc * min(opp.kelly_fraction, 1.0)
        size_usdc = max(1.0, min(kelly_usdc, self._config.order_size_usdc))

        if opp.side == "BUY":
            price = round(min(0.98, opp.market_price + 0.01), 2)
        else:
            price = round(max(0.02, opp.market_price - 0.01), 2)

        tokens = round(size_usdc / price, 2)
        label = opp.question[:60]

        try:
            if self._config.dry_run:
                order_id = "DRY_RUN"
                logger.info(
                    "[DRY RUN] DIRECTION %s | edge=%+.1f¢ | kelly=%.0f%% | price=%.0f¢ | "
                    "BTC=$%.0f vs $%.0f | %.1fmin left | %s",
                    opp.side, opp.edge_cents, opp.kelly_fraction * 100,
                    price * 100, opp.btc_price, opp.threshold,
                    opp.minutes_left, label,
                )
            else:
                resp = await self._client.create_and_post_order(
                    opp.token_id, price, tokens, opp.side
                )
                order_id = resp.get("orderID") or resp.get("order_id", "")
                logger.info(
                    "DIRECTION %s | edge=%+.1f¢ | kelly=%.0f%% | price=%.0f¢ | "
                    "BTC=$%.0f vs $%.0f | %.1fmin left",
                    opp.side, opp.edge_cents, opp.kelly_fraction * 100,
                    price * 100, opp.btc_price, opp.threshold, opp.minutes_left,
                )

            self.positions[opp.token_id] = DirectionPosition(
                token_id=opp.token_id,
                question=opp.question,
                side=opp.side,
                entry_price=price,
                size=tokens,
                order_id=order_id,
                opened_at=time.time(),
                threshold=opp.threshold,
                btc_at_entry=opp.btc_price,
            )
            self.trade_count += 1

            await self._notifier.position_opened(
                opp.side, opp.question,
                price * 100,
                opp.model_prob * 100,
                tokens,
            )
        except Exception as exc:
            logger.warning("Direction entry failed [%s]: %s", label, exc)

    async def expire_positions(self) -> None:
        """Prune positions that are past max hold time (they auto-settle on-chain)."""
        now = time.time()
        max_hold = self._config.direction_max_minutes * 60 + 120  # 2-min grace
        for tid in list(self.positions.keys()):
            if now - self.positions[tid].opened_at > max_hold:
                pos = self.positions.pop(tid)
                logger.info("Direction position expired: %s", pos.question[:60])
