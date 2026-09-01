"""Copy trading: mirror specific wallets' Polymarket positions.

Strategy:
  1. Poll Polymarket's public data API (data-api.polymarket.com) for each
     followed wallet's recent activity.
  2. Detect trades not yet mirrored (tracked by trade hash/id per wallet).
  3. Scale the followed trader's size by COPY_RATIO and place a matching
     order in the same direction.
  4. Exit when the followed wallet exits (sells their position).

Wallet addresses must be supplied manually via COPY_TRADER_WALLETS in .env —
grab them from polymarket.com/leaderboard or any trader's public profile URL
(polymarket.com/profile/0x...). There is no verified public "top traders"
endpoint, so this is a watchlist you curate yourself.

The data-api endpoints used here (`/activity`, `/positions`) are the same
ones polymarket.com's own frontend calls — no auth required for public data.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from bot.client import PolyClient
    from bot.config import Config
    from bot.notifications import Notifier
    from bot.risk import RiskManager

logger = logging.getLogger(__name__)

_DATA_API = "https://data-api.polymarket.com"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PolymarketBot/1.0)",
    "Accept": "application/json",
}


@dataclass
class CopyOpportunity:
    wallet: str
    token_id: str
    market_question: str
    side: str            # "BUY" or "SELL"
    their_price: float    # price they traded at (0-1)
    their_size: float     # their token quantity
    trade_id: str          # unique id to dedupe


@dataclass
class CopyPosition:
    wallet: str
    token_id: str
    question: str
    side: str
    entry_price: float
    size: float
    order_id: str
    opened_at: float


def _http_get_json(url: str) -> Optional[list | dict]:
    req = urllib.request.Request(url, headers=_HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        logger.debug("Copy-trade fetch HTTP %s for %s", exc.code, url)
        return None
    except Exception as exc:
        logger.debug("Copy-trade fetch failed for %s: %s", url, exc)
        return None


class CopyTraderScanner:
    """Polls followed wallets' activity feeds for new trades to mirror."""

    def __init__(self, config: Config) -> None:
        self._config = config
        # wallet -> set of trade ids already seen (so we don't re-mirror)
        self._seen: dict[str, set[str]] = {
            w: set() for w in config.copy_trader_wallets
        }
        self._primed: set[str] = set()

    async def scan(self) -> list[CopyOpportunity]:
        if not self._config.copy_trader_wallets:
            return []

        loop = asyncio.get_running_loop()
        opps: list[CopyOpportunity] = []

        for wallet in self._config.copy_trader_wallets:
            activity = await loop.run_in_executor(None, self._fetch_activity, wallet)
            if not activity:
                continue

            new_opps = self._extract_new_trades(wallet, activity)
            opps.extend(new_opps)

        if opps:
            logger.info("Copy-trade scan: %d new trades to mirror across %d wallets",
                        len(opps), len(self._config.copy_trader_wallets))
        return opps

    def _fetch_activity(self, wallet: str) -> Optional[list[dict]]:
        url = f"{_DATA_API}/activity?user={wallet}&limit=20&type=TRADE"
        data = _http_get_json(url)
        if isinstance(data, list):
            return data
        return None

    def _extract_new_trades(self, wallet: str, activity: list[dict]) -> list[CopyOpportunity]:
        seen = self._seen.setdefault(wallet, set())
        first_poll = wallet not in self._primed

        opps: list[CopyOpportunity] = []
        for entry in activity:
            trade_id = str(
                entry.get("transactionHash") or entry.get("id") or entry.get("timestamp", "")
            )
            if not trade_id or trade_id in seen:
                continue
            seen.add(trade_id)

            # On the very first poll, just record state — don't mirror history
            if first_poll:
                continue

            token_id = entry.get("asset") or entry.get("token_id") or ""
            if not token_id:
                continue

            raw_side = str(entry.get("side", "")).upper()
            side = "BUY" if raw_side == "BUY" else "SELL" if raw_side == "SELL" else ""
            if not side:
                continue

            try:
                price = float(entry.get("price", 0))
                size = float(entry.get("size", 0))
            except (TypeError, ValueError):
                continue

            if price <= 0 or size <= 0:
                continue

            opps.append(CopyOpportunity(
                wallet=wallet,
                token_id=token_id,
                market_question=entry.get("title") or entry.get("question") or "",
                side=side,
                their_price=price,
                their_size=size,
                trade_id=trade_id,
            ))

        self._primed.add(wallet)
        return opps


class CopyExecutor:
    """Mirrors followed wallets' trades at a scaled-down size."""

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
        self.positions: dict[str, CopyPosition] = {}
        self.trade_count: int = 0

    async def process(self, opp: CopyOpportunity) -> None:
        key = f"{opp.wallet}:{opp.token_id}"

        if opp.side == "SELL" and key in self.positions:
            await self._exit(key, opp)
            return

        if opp.side != "BUY" or key in self.positions:
            return

        mirrored_size_usdc = min(
            opp.their_size * opp.their_price * self._config.copy_ratio,
            self._config.copy_max_position_usdc,
        )
        if mirrored_size_usdc < 1.0:
            return
        if not self._risk.can_enter(opp.token_id, mirrored_size_usdc):
            return

        price = round(min(0.98, opp.their_price + 0.01), 2)
        tokens = round(mirrored_size_usdc / price, 2)
        label = (opp.market_question or opp.token_id)[:60]

        try:
            if self._config.dry_run:
                order_id = "DRY_RUN"
                logger.info(
                    "[DRY RUN] COPY BUY from %s..%s | %.2f USDC @ %.0f¢ | %s",
                    opp.wallet[:6], opp.wallet[-4:], mirrored_size_usdc, price * 100, label,
                )
            else:
                resp = await self._client.create_and_post_order(opp.token_id, price, tokens, "BUY")
                order_id = resp.get("orderID") or resp.get("order_id", "")
                logger.info(
                    "COPY BUY from %s..%s | %.2f USDC @ %.0f¢ | %s",
                    opp.wallet[:6], opp.wallet[-4:], mirrored_size_usdc, price * 100, label,
                )

            self.positions[key] = CopyPosition(
                wallet=opp.wallet,
                token_id=opp.token_id,
                question=opp.market_question,
                side="LONG",
                entry_price=price,
                size=tokens,
                order_id=order_id,
                opened_at=time.time(),
            )
            self.trade_count += 1

            await self._notifier.position_opened("COPY", label, price * 100, opp.their_price * 100, tokens)
        except Exception as exc:
            logger.warning("Copy-trade entry failed [%s]: %s", label, exc)

    async def _exit(self, key: str, opp: CopyOpportunity) -> None:
        pos = self.positions[key]
        label = (pos.question or pos.token_id)[:60]
        exit_price = round(max(0.02, opp.their_price - 0.01), 2)
        pnl_usdc = (exit_price - pos.entry_price) * pos.size

        try:
            if not self._config.dry_run:
                await self._client.create_and_post_order(pos.token_id, exit_price, pos.size, "SELL")

            self._risk.record_fill(pos.token_id, pnl_usdc)
            del self.positions[key]
            self.trade_count += 1

            logger.info(
                "COPY EXIT (followed wallet sold) %s | %.0f¢ → %.0f¢ | P&L: %+.4f USDC%s",
                label, pos.entry_price * 100, exit_price * 100, pnl_usdc,
                " [DRY RUN]" if self._config.dry_run else "",
            )
            await self._notifier.position_closed("COPY", label, pos.entry_price * 100, exit_price * 100, pnl_usdc)
        except Exception as exc:
            logger.warning("Copy-trade exit failed [%s]: %s", label, exc)
