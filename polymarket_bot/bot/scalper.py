from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum, auto
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.client import PolyClient
    from bot.config import Config
    from bot.risk import RiskManager
    from bot.scanner import Opportunity

logger = logging.getLogger(__name__)


class ScalperState(Enum):
    IDLE = auto()
    QUOTING = auto()
    POSITION_LONG = auto()   # bought YES, waiting for take-profit or stop-loss
    POSITION_SHORT = auto()  # sold YES (bought NO effectively), waiting for TP/SL
    STOPPING = auto()


@dataclass
class ActiveOrder:
    order_id: str
    side: str       # "BUY" | "SELL"
    price: float    # fractional (0–1)
    size: float
    posted_at: float = field(default_factory=time.monotonic)


@dataclass
class Position:
    side: str             # "LONG" | "SHORT"
    entry_price: float    # fractional
    size: float
    token_id: str
    stop_price: float
    take_profit_price: float
    tp_order_id: str | None = None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MarketScalper:
    """Async state machine for scalping a single Polymarket market."""

    def __init__(
        self,
        opportunity: Opportunity,
        client: PolyClient,
        config: Config,
        risk_manager: RiskManager,
    ) -> None:
        self.opportunity = opportunity
        self._client = client
        self._config = config
        self._risk = risk_manager

        self.state = ScalperState.IDLE
        self._bid_order: ActiveOrder | None = None
        self._ask_order: ActiveOrder | None = None
        self._position: Position | None = None
        self._stop_event = asyncio.Event()
        self._last_trade_ts: str = _iso_now()

    # -------------------------------------------------------------------------
    # Public interface
    # -------------------------------------------------------------------------

    async def run(self) -> None:
        label = self.opportunity.question[:50]
        logger.info("[%s] Scalper starting", label)
        try:
            while not self._stop_event.is_set():
                try:
                    await self._tick()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error("[%s] Tick error: %s", label, exc, exc_info=True)
                await asyncio.sleep(self._config.requote_delay_seconds)
        finally:
            await self._cleanup()
            logger.info("[%s] Scalper stopped", label)

    def stop(self) -> None:
        self._stop_event.set()

    # -------------------------------------------------------------------------
    # State machine
    # -------------------------------------------------------------------------

    async def _tick(self) -> None:
        if self.state == ScalperState.IDLE:
            await self._enter_quotes()

        elif self.state == ScalperState.QUOTING:
            await self._check_quote_fills()

        elif self.state in (ScalperState.POSITION_LONG, ScalperState.POSITION_SHORT):
            await self._manage_position()

    # -------------------------------------------------------------------------
    # IDLE → QUOTING
    # -------------------------------------------------------------------------

    async def _enter_quotes(self) -> None:
        if not self._risk.can_enter(self.opportunity.token_id_yes, self._config.order_size_usdc):
            return

        book = await self._client.get_order_book(self.opportunity.token_id_yes)
        bids = getattr(book, "bids", []) or []
        asks = getattr(book, "asks", []) or []
        if not bids or not asks:
            return

        best_bid = float(bids[0].get("price", 0))
        best_ask = float(asks[0].get("price", 1))
        spread_cents = (best_ask - best_bid) * 100

        if spread_cents < self._config.min_spread_cents:
            return

        bid_price = round(best_bid + 0.01, 2)
        ask_price = round(best_ask - 0.01, 2)

        if ask_price <= bid_price:
            return

        bid_size = self._risk.compute_order_size(bid_price)
        ask_size = self._risk.compute_order_size(ask_price)

        label = self.opportunity.question[:40]
        try:
            bid_resp = await self._client.create_and_post_order(
                self.opportunity.token_id_yes, bid_price, bid_size, "BUY"
            )
            bid_id = bid_resp.get("orderID") or bid_resp.get("order_id", "")
            self._bid_order = ActiveOrder(bid_id, "BUY", bid_price, bid_size)

            ask_resp = await self._client.create_and_post_order(
                self.opportunity.token_id_yes, ask_price, ask_size, "SELL"
            )
            ask_id = ask_resp.get("orderID") or ask_resp.get("order_id", "")
            self._ask_order = ActiveOrder(ask_id, "SELL", ask_price, ask_size)

            self.state = ScalperState.QUOTING
            logger.info(
                "[%s] Quoted bid=%.2f ask=%.2f spread=%.1fc",
                label, bid_price * 100, ask_price * 100, spread_cents,
            )
        except Exception as exc:
            logger.warning("[%s] Failed to post quotes: %s", label, exc)
            await self._cancel_open_quotes()
            self.state = ScalperState.IDLE

    # -------------------------------------------------------------------------
    # QUOTING — poll for fills / handle stale orders
    # -------------------------------------------------------------------------

    async def _check_quote_fills(self) -> None:
        now = time.monotonic()
        bid_stale = self._bid_order and (now - self._bid_order.posted_at) > self._config.order_ttl_seconds
        ask_stale = self._ask_order and (now - self._ask_order.posted_at) > self._config.order_ttl_seconds

        if bid_stale or ask_stale:
            logger.debug("[%s] Orders stale — re-quoting", self.opportunity.question[:40])
            await self._cancel_open_quotes()
            self.state = ScalperState.IDLE
            return

        trades = await self._client.get_trades(
            asset_id=self.opportunity.token_id_yes,
            after=self._last_trade_ts,
        )
        self._last_trade_ts = _iso_now()

        for trade in trades:
            maker_order_id = trade.get("maker_order_id") or trade.get("makerOrderId", "")
            taker_order_id = trade.get("taker_order_id") or trade.get("takerOrderId", "")
            matched_id = None
            if self._bid_order and maker_order_id == self._bid_order.order_id:
                matched_id = self._bid_order.order_id
                await self._on_bid_filled(self._bid_order, trade)
                return
            if self._ask_order and maker_order_id == self._ask_order.order_id:
                matched_id = self._ask_order.order_id
                await self._on_ask_filled(self._ask_order, trade)
                return

    async def _on_bid_filled(self, order: ActiveOrder, trade: dict) -> None:
        fill_price = float(trade.get("price", order.price))
        fill_size = float(trade.get("size", order.size))
        label = self.opportunity.question[:40]
        logger.info("[%s] BID FILLED at %.2fc size=%.2f", label, fill_price * 100, fill_size)

        # Cancel the other side
        if self._ask_order:
            try:
                await self._client.cancel_order(self._ask_order.order_id)
            except Exception:
                pass
        self._ask_order = None
        self._bid_order = None

        tp_price = round(fill_price + self._config.target_profit_cents / 100, 2)
        sl_price = round(fill_price - self._config.stop_loss_cents / 100, 2)

        tp_resp = await self._client.create_and_post_order(
            self.opportunity.token_id_yes, tp_price, fill_size, "SELL"
        )
        tp_id = tp_resp.get("orderID") or tp_resp.get("order_id", "")

        self._position = Position(
            side="LONG",
            entry_price=fill_price,
            size=fill_size,
            token_id=self.opportunity.token_id_yes,
            stop_price=sl_price,
            take_profit_price=tp_price,
            tp_order_id=tp_id,
        )
        self.state = ScalperState.POSITION_LONG
        logger.info("[%s] LONG position open — TP=%.2fc SL=%.2fc", label, tp_price * 100, sl_price * 100)

    async def _on_ask_filled(self, order: ActiveOrder, trade: dict) -> None:
        fill_price = float(trade.get("price", order.price))
        fill_size = float(trade.get("size", order.size))
        label = self.opportunity.question[:40]
        logger.info("[%s] ASK FILLED at %.2fc size=%.2f", label, fill_price * 100, fill_size)

        if self._bid_order:
            try:
                await self._client.cancel_order(self._bid_order.order_id)
            except Exception:
                pass
        self._bid_order = None
        self._ask_order = None

        tp_price = round(fill_price - self._config.target_profit_cents / 100, 2)
        sl_price = round(fill_price + self._config.stop_loss_cents / 100, 2)

        tp_resp = await self._client.create_and_post_order(
            self.opportunity.token_id_yes, tp_price, fill_size, "BUY"
        )
        tp_id = tp_resp.get("orderID") or tp_resp.get("order_id", "")

        self._position = Position(
            side="SHORT",
            entry_price=fill_price,
            size=fill_size,
            token_id=self.opportunity.token_id_yes,
            stop_price=sl_price,
            take_profit_price=tp_price,
            tp_order_id=tp_id,
        )
        self.state = ScalperState.POSITION_SHORT
        logger.info("[%s] SHORT position open — TP=%.2fc SL=%.2fc", label, tp_price * 100, sl_price * 100)

    # -------------------------------------------------------------------------
    # POSITION — manage open position
    # -------------------------------------------------------------------------

    async def _manage_position(self) -> None:
        pos = self._position
        if not pos:
            self.state = ScalperState.IDLE
            return

        label = self.opportunity.question[:40]

        # Check if TP order filled
        trades = await self._client.get_trades(
            asset_id=pos.token_id,
            after=self._last_trade_ts,
        )
        self._last_trade_ts = _iso_now()

        for trade in trades:
            maker_order_id = trade.get("maker_order_id") or trade.get("makerOrderId", "")
            if pos.tp_order_id and maker_order_id == pos.tp_order_id:
                pnl = self._config.target_profit_cents / 100 * pos.size
                self._risk.record_fill(self.opportunity.condition_id, pnl)
                logger.info("[%s] TAKE-PROFIT filled — P&L: +%.4f USDC", label, pnl)
                self._position = None
                self.state = ScalperState.IDLE
                return

        # Check stop-loss via current book mid-price
        try:
            book = await self._client.get_order_book(pos.token_id)
            bids = getattr(book, "bids", []) or []
            asks = getattr(book, "asks", []) or []
            if not bids or not asks:
                return
            mid = (float(bids[0].get("price", 0)) + float(asks[0].get("price", 1))) / 2
        except Exception:
            return

        sl_triggered = (
            (pos.side == "LONG" and mid <= pos.stop_price) or
            (pos.side == "SHORT" and mid >= pos.stop_price)
        )

        if sl_triggered:
            logger.warning("[%s] STOP-LOSS triggered at mid=%.2fc", label, mid * 100)
            await self._emergency_exit(pos, mid)

    async def _emergency_exit(self, pos: Position, exit_price: float) -> None:
        label = self.opportunity.question[:40]
        if pos.tp_order_id:
            try:
                await self._client.cancel_order(pos.tp_order_id)
            except Exception:
                pass

        exit_side = "SELL" if pos.side == "LONG" else "BUY"
        try:
            from py_clob_client.clob_types import OrderType
            await self._client.create_and_post_order(
                pos.token_id, exit_price, pos.size, exit_side, OrderType.FOK
            )
        except Exception as exc:
            logger.error("[%s] Emergency exit order failed: %s — trying market cancel", label, exc)
            await self._client.cancel_market_orders(pos.token_id)

        pnl = (exit_price - pos.entry_price) * pos.size * (1 if pos.side == "LONG" else -1)
        self._risk.record_fill(self.opportunity.condition_id, pnl)
        logger.warning("[%s] Emergency exit complete — P&L: %.4f USDC", label, pnl)
        self._position = None
        self.state = ScalperState.IDLE

    # -------------------------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------------------------

    async def _cancel_open_quotes(self) -> None:
        ids = []
        if self._bid_order:
            ids.append(self._bid_order.order_id)
        if self._ask_order:
            ids.append(self._ask_order.order_id)
        if ids:
            try:
                await self._client.cancel_orders(ids)
            except Exception as exc:
                logger.warning("Failed to cancel quotes: %s", exc)
        self._bid_order = None
        self._ask_order = None

    async def _cleanup(self) -> None:
        try:
            await self._client.cancel_market_orders(self.opportunity.token_id_yes)
        except Exception as exc:
            logger.warning("Cleanup cancel failed for %s: %s", self.opportunity.token_id_yes[:12], exc)
        self._position = None
        self._bid_order = None
        self._ask_order = None
