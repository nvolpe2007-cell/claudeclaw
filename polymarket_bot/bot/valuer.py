from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.client import PolyClient
    from bot.config import Config
    from bot.opportunity import Opportunity
    from bot.risk import RiskManager

logger = logging.getLogger(__name__)


@dataclass
class ValuePosition:
    """Represents an open value-betting position."""

    side: str  # "LONG" | "SHORT"
    token_id: str
    entry_price: float
    fair_value_at_entry: float
    size: float
    order_id: str
    opened_at: float
    tp_order_id: str | None = None


class ValueExecutor:
    """Executes value-betting trades: buy undervalued, sell overvalued."""

    def __init__(
        self,
        client: PolyClient,
        config: Config,
        risk: RiskManager,
    ) -> None:
        self._client = client
        self._config = config
        self._risk = risk
        self.positions: dict[str, ValuePosition] = {}

    async def process_opportunity(self, opp: Opportunity) -> None:
        """Execute a trade if this is a good opportunity."""
        token_id = opp.token_id
        label = opp.question[:50]

        # Check if we should enter or exit
        if opp.side == "BUY" and token_id not in self.positions:
            await self._enter_long(opp)

        elif opp.side == "SELL" and token_id in self.positions:
            await self._exit_position(opp)

        elif opp.side == "SELL" and token_id not in self.positions:
            # Optionally also enter short positions
            await self._enter_short(opp)

        elif opp.side == "BUY" and token_id in self.positions:
            # Could tighten existing long position here if desired
            pass

    async def _enter_long(self, opp: Opportunity) -> None:
        """Enter a long position (buy undervalued YES)."""
        if not self._risk.can_enter(opp.token_id, self._config.order_size_usdc):
            logger.debug("Entry blocked for %s (risk check)", opp.token_id)
            return

        if len(self.positions) >= self._config.max_concurrent_positions:
            logger.debug("Max concurrent positions reached")
            return

        label = opp.question[:50]
        entry_price = round(opp.current_price + 0.01, 2)  # improve bid by 1 cent
        size = self._risk.compute_order_size(entry_price)

        try:
            order_resp = await self._client.create_and_post_order(
                opp.token_id, entry_price, size, "BUY"
            )
            order_id = order_resp.get("orderID") or order_resp.get("order_id", "")

            self.positions[opp.token_id] = ValuePosition(
                side="LONG",
                token_id=opp.token_id,
                entry_price=entry_price,
                fair_value_at_entry=opp.fair_value,
                size=size,
                order_id=order_id,
                opened_at=time.time(),
            )

            logger.info(
                "[%s] LONG ENTRY: %.2fc (fair=%.2fc) size=%.2f",
                label,
                entry_price * 100,
                opp.fair_value * 100,
                size,
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
        entry_price = round(opp.current_price - 0.01, 2)  # improve ask by 1 cent
        size = self._risk.compute_order_size(entry_price)

        try:
            order_resp = await self._client.create_and_post_order(
                opp.token_id, entry_price, size, "SELL"
            )
            order_id = order_resp.get("orderID") or order_resp.get("order_id", "")

            self.positions[opp.token_id] = ValuePosition(
                side="SHORT",
                token_id=opp.token_id,
                entry_price=entry_price,
                fair_value_at_entry=opp.fair_value,
                size=size,
                order_id=order_id,
                opened_at=time.time(),
            )

            logger.info(
                "[%s] SHORT ENTRY: %.2fc (fair=%.2fc) size=%.2f",
                label,
                entry_price * 100,
                opp.fair_value * 100,
                size,
            )
        except Exception as exc:
            logger.warning("[%s] Entry failed: %s", label, exc)

    async def _exit_position(self, opp: Opportunity) -> None:
        """Exit an open position."""
        token_id = opp.token_id
        pos = self.positions[token_id]
        label = opp.question[:50]

        exit_price = round(opp.current_price, 2)
        if pos.side == "LONG":
            exit_price = round(opp.current_price - 0.01, 2)  # improve ask by 1 cent
            side = "SELL"
        else:  # SHORT
            exit_price = round(opp.current_price + 0.01, 2)  # improve bid by 1 cent
            side = "BUY"

        try:
            order_resp = await self._client.create_and_post_order(
                token_id, exit_price, pos.size, side
            )

            # Calculate P&L
            if pos.side == "LONG":
                pnl_cents = (exit_price - pos.entry_price) * 100
            else:  # SHORT
                pnl_cents = (pos.entry_price - exit_price) * 100

            pnl_usdc = pnl_cents / 100 * pos.size

            self._risk.record_fill(token_id, pnl_usdc)
            del self.positions[token_id]

            logger.info(
                "[%s] EXIT %s: %.2fc → %.2fc | P&L: %+.4f USDC",
                label,
                pos.side,
                pos.entry_price * 100,
                exit_price * 100,
                pnl_usdc,
            )
        except Exception as exc:
            logger.warning("[%s] Exit failed: %s", label, exc)

    async def rebalance_positions(self) -> None:
        """Check if any positions should be closed or rebalanced."""
        now = time.time()
        for token_id in list(self.positions.keys()):
            pos = self.positions[token_id]
            hold_duration = now - pos.opened_at

            # Force-close positions held longer than max duration
            if hold_duration > self._config.max_position_hold_duration:
                label = "unknown"
                try:
                    # Fetch current price and close
                    book = await self._client.get_order_book(token_id)
                    bids = getattr(book, "bids", []) or []
                    asks = getattr(book, "asks", []) or []
                    if bids and asks:
                        mid = (float(bids[0].get("price", 0)) + float(asks[0].get("price", 1))) / 2
                        exit_price = round(mid, 2)

                        side = "SELL" if pos.side == "LONG" else "BUY"
                        await self._client.create_and_post_order(token_id, exit_price, pos.size, side)

                        pnl_usdc = (exit_price - pos.entry_price) * pos.size * (
                            1 if pos.side == "LONG" else -1
                        )
                        self._risk.record_fill(token_id, pnl_usdc)
                        del self.positions[token_id]

                        logger.info("[%s] Force-closed after %.0fs hold", label, hold_duration)
                except Exception as exc:
                    logger.warning("Rebalance error: %s", exc)
