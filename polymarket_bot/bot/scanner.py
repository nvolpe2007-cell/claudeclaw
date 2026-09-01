from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.client import PolyClient
    from bot.config import Config

logger = logging.getLogger(__name__)

END_CURSOR = "LTE="

_BTC_KEYWORDS = {"btc", "bitcoin"}


@dataclass
class Opportunity:
    condition_id: str
    token_id_yes: str
    token_id_no: str
    question: str
    best_bid: float   # as fraction (e.g. 0.47)
    best_ask: float   # as fraction (e.g. 0.49)
    spread: float     # in cents (e.g. 2.0)
    volume_24h: float
    mid: float        # (best_bid + best_ask) / 2


class MarketScanner:
    def __init__(self, client: PolyClient, config: Config) -> None:
        self._client = client
        self._config = config

    async def scan(self) -> list[Opportunity]:
        markets = await self._fetch_all_markets()
        logger.info("Scanner fetched %d active markets", len(markets))

        opportunities: list[Opportunity] = []
        for market in markets:
            opp = await self._evaluate_market(market)
            if opp:
                opportunities.append(opp)

        opportunities.sort(key=lambda o: o.spread, reverse=True)
        logger.info("Scanner found %d eligible opportunities", len(opportunities))
        return opportunities

    async def _fetch_all_markets(self) -> list[dict]:
        markets: list[dict] = []
        cursor = ""
        while True:
            try:
                page = await self._client.get_markets(next_cursor=cursor)
            except Exception as exc:
                logger.error("Failed to fetch markets page: %s", exc)
                break

            data = page.get("data", []) if isinstance(page, dict) else []
            markets.extend(data)

            next_cursor = page.get("next_cursor", END_CURSOR) if isinstance(page, dict) else END_CURSOR
            if next_cursor == END_CURSOR or not next_cursor:
                break
            cursor = next_cursor

        return [m for m in markets if self._is_market_active(m)]

    def _is_market_active(self, market: dict) -> bool:
        if not (
            market.get("active", False)
            and not market.get("closed", True)
            and not market.get("archived", False)
            and len(market.get("tokens", [])) == 2
        ):
            return False
        if self._config.btc_only and not self._is_btc_market(market):
            return False
        return True

    def _is_btc_market(self, market: dict) -> bool:
        question = (market.get("question") or "").lower()
        if any(kw in question for kw in _BTC_KEYWORDS):
            return True
        # Also check tags if present
        tags = market.get("tags") or []
        return any(
            any(kw in str(tag).lower() for kw in _BTC_KEYWORDS)
            for tag in tags
        )

    async def _evaluate_market(self, market: dict) -> Opportunity | None:
        tokens = market.get("tokens", [])
        yes_token = next((t for t in tokens if t.get("outcome", "").upper() == "YES"), None)
        no_token = next((t for t in tokens if t.get("outcome", "").upper() == "NO"), None)
        if not yes_token or not no_token:
            return None

        token_id_yes = yes_token.get("token_id", "")
        token_id_no = no_token.get("token_id", "")
        if not token_id_yes or not token_id_no:
            return None

        try:
            book = await self._client.get_order_book(token_id_yes)
        except Exception as exc:
            logger.debug("Order book fetch failed for %s: %s", token_id_yes[:12], exc)
            return None

        bids = getattr(book, "bids", []) or []
        asks = getattr(book, "asks", []) or []

        if len(bids) < 3 or len(asks) < 3:
            return None

        try:
            best_bid = float(bids[0].get("price", 0))
            best_ask = float(asks[0].get("price", 1))
        except (TypeError, ValueError):
            return None

        spread_cents = (best_ask - best_bid) * 100
        mid = (best_bid + best_ask) / 2
        mid_cents = mid * 100

        if spread_cents < self._config.min_spread_cents:
            return None
        if mid_cents < self._config.min_price_cents or mid_cents > self._config.max_price_cents:
            return None

        volume = float(market.get("volume", 0) or 0)
        if volume < self._config.min_volume_usd:
            return None

        return Opportunity(
            condition_id=market.get("condition_id", ""),
            token_id_yes=token_id_yes,
            token_id_no=token_id_no,
            question=market.get("question", ""),
            best_bid=best_bid,
            best_ask=best_ask,
            spread=spread_cents,
            volume_24h=volume,
            mid=mid,
        )
