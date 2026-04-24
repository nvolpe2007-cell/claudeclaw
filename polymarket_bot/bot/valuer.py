from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.client import PolyClient
    from bot.config import Config
    from bot.notifications import Notifier
    from bot.opportunity import Opportunity
    from bot.risk import RiskManager

logger = logging.getLogger(__name__)

_DRY_RUN_ORDER_ID = "DRY_RUN"


@dataclass
class ValuePosition:
    """Represents an open value-betting position."""

    side: str  # "LONG" | "SHORT"
    token_id: str
    question: str
    entry_price: float
    fair_value_at_entry: float
    size: float
    order_id: str
    opened_at: float


class ValueExecutor:
    """Executes value-betting trades: buy undervalued, sell overvalued."""

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
        self.positions: dict[str, ValuePosition] = {}
        self.trade_count: int = 0

    async def process_opportunity(self, opp: Opportunity) -> None:
        """Execute a trade if this is a good opportunity."""
        token_id = opp.token_id

        if opp.side == "BUY" and token_id not in self.positions:
            await self._enter_long(opp)

        elif opp.side == "SELL" and token_id in self.positions:
            await self._exit_position(opp)

        elif opp.side == "SELL" and token_id not in self.positions:
            await self._enter_short(opp)

    async def _enter_long(self, opp: Opportunity) -> None:
        """Enter a long position (buy undervalued YES)."""
        if not self._risk.can_enter(opp.token_id, self._config.order_size_usdc):
            return
        if len(self.positions) >= self._config.max_concurrent_positions:
            return

        label = opp.question[:50]
        entry_price = round(opp.current_price + 0.01, 2)
        size = self._risk.compute_order_size(entry_price)

        try:
            if self._config.dry_run:
                order_id = _DRY_RUN_ORDER_ID
                logger.info("[DRY RUN] [%s] LONG ENTRY: %.2fc (fair=%.2fc) size=%.2f", label, entry_price * 100, opp.fair_value * 100, size)
            else:
                order_resp = await self._client.create_and_post_order(
                    opp.token_id, entry_price, size, "BUY"
                )
                order_id = order_resp.get("orderID") or order_resp.get("order_id", "")
                logger.info("[%s] LONG ENTRY: %.2fc (fair=%.2fc) size=%.2f", label, entry_price * 100, opp.fair_value * 100, size)

            self.positions[opp.token_id] = ValuePosition(
                side="LONG",
                token_id=opp.token_id,
                question=opp.question,
                entry_price=entry_price,
                fair_value_at_entry=opp.fair_value,
                size=size,
                order_id=order_id,
                opened_at=time.time(),
            )
            self.trade_count += 1

            await self._notifier.position_opened(
                "LONG", opp.question, entry_price * 100, opp.fair_value * 100, size
            )
        except Exception as exc:
            logger.warning("[%s] Entry failed: %s", label, exc)

    async def _enter_short(self, opp: Opportunity) -> None:
        """Enter a short position (sell overvalued YES)."""
        if not self._risk.can_enter(opp.token_id, self._config.order_size_usdc):
            return
        if len(self.positions) >= self._config.max_concurrent_positions:
            return

        label = opp.question[:50]
        entry_price = round(opp.current_price - 0.01, 2)
        size = self._risk.compute_order_size(entry_price)

        try:
            if self._config.dry_run:
                order_id = _DRY_RUN_ORDER_ID
                logger.info("[DRY RUN] [%s] SHORT ENTRY: %.2fc (fair=%.2fc) size=%.2f", label, entry_price * 100, opp.fair_value * 100, size)
            else:
                order_resp = await self._client.create_and_post_order(
                    opp.token_id, entry_price, size, "SELL"
                )
                order_id = order_resp.get("orderID") or order_resp.get("order_id", "")
                logger.info("[%s] SHORT ENTRY: %.2fc (fair=%.2fc) size=%.2f", label, entry_price * 100, opp.fair_value * 100, size)

            self.positions[opp.token_id] = ValuePosition(
                side="SHORT",
                token_id=opp.token_id,
                question=opp.question,
                entry_price=entry_price,
                fair_value_at_entry=opp.fair_value,
                size=size,
                order_id=order_id,
                opened_at=time.time(),
            )
            self.trade_count += 1

            await self._notifier.position_opened(
                "SHORT", opp.question, entry_price * 100, opp.fair_value * 100, size
            )
        except Exception as exc:
            logger.warning("[%s] Entry failed: %s", label, exc)

    async def _exit_position(self, opp: Opportunity) -> None:
        """Exit an open position."""
        token_id = opp.token_id
        pos = self.positions[token_id]
        label = opp.question[:50]

        if pos.side == "LONG":
            exit_price = round(opp.current_price - 0.01, 2)
            side = "SELL"
            pnl_usdc = (exit_price - pos.entry_price) * pos.size
        else:
            exit_price = round(opp.current_price + 0.01, 2)
            side = "BUY"
            pnl_usdc = (pos.entry_price - exit_price) * pos.size

        try:
            if self._config.dry_run:
                logger.info("[DRY RUN] [%s] EXIT %s: %.2fc → %.2fc | P&L: %+.4f USDC", label, pos.side, pos.entry_price * 100, exit_price * 100, pnl_usdc)
            else:
                await self._client.create_and_post_order(token_id, exit_price, pos.size, side)
                logger.info("[%s] EXIT %s: %.2fc → %.2fc | P&L: %+.4f USDC", label, pos.side, pos.entry_price * 100, exit_price * 100, pnl_usdc)

            self._risk.record_fill(token_id, pnl_usdc)
            del self.positions[token_id]
            self.trade_count += 1

            await self._notifier.position_closed(
                pos.side, opp.question, pos.entry_price * 100, exit_price * 100, pnl_usdc
            )
        except Exception as exc:
            logger.warning("[%s] Exit failed: %s", label, exc)

    async def rebalance_positions(self) -> None:
        """Force-close positions held longer than max duration."""
        now = time.time()
        for token_id in list(self.positions.keys()):
            pos = self.positions[token_id]
            if now - pos.opened_at < self._config.max_position_hold_duration:
                continue

            try:
                book = await self._client.get_order_book(token_id)
                bids = getattr(book, "bids", []) or []
                asks = getattr(book, "asks", []) or []
                if not bids or not asks:
                    continue

                mid = (float(bids[0].get("price", 0)) + float(asks[0].get("price", 1))) / 2
                exit_price = round(mid, 2)
                side = "SELL" if pos.side == "LONG" else "BUY"
                pnl_usdc = (exit_price - pos.entry_price) * pos.size * (1 if pos.side == "LONG" else -1)

                if not self._config.dry_run:
                    await self._client.create_and_post_order(token_id, exit_price, pos.size, side)

                self._risk.record_fill(token_id, pnl_usdc)
                del self.positions[token_id]
                self.trade_count += 1

                logger.info("[%s] Force-closed after %.0fs | P&L: %+.4f USDC", pos.question[:40], now - pos.opened_at, pnl_usdc)
                await self._notifier.position_closed(
                    pos.side, pos.question, pos.entry_price * 100, exit_price * 100, pnl_usdc
                )
            except Exception as exc:
                logger.warning("Rebalance error for %s: %s", token_id[:12], exc)
