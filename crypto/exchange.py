"""
Binance Futures async client.
- WebSocket streams for real-time kline data (250ms updates on Futures)
- Async REST for order placement (non-blocking)
- Auto-reconnect with exponential backoff
- Paper-trading mode: prints orders instead of sending them
"""

from __future__ import annotations
import asyncio
import logging
import time
from collections import deque
from typing import Callable, Dict, Deque, Optional

import pandas as pd
from binance import AsyncClient, BinanceSocketManager
from binance.enums import (
    SIDE_BUY, SIDE_SELL,
    ORDER_TYPE_LIMIT, ORDER_TYPE_MARKET,
    FUTURE_ORDER_TYPE_STOP_MARKET, FUTURE_ORDER_TYPE_TAKE_PROFIT_MARKET,
    TIME_IN_FORCE_GTC,
)
from config import cfg

log = logging.getLogger(__name__)

# Number of OHLCV bars to keep in memory per symbol per interval
BUFFER_SIZE = 220


class ExchangeClient:
    def __init__(self):
        self._client: Optional[AsyncClient] = None
        self._bsm:    Optional[BinanceSocketManager] = None
        # symbol → interval → deque of [open, high, low, close, volume] rows
        self._buffers: Dict[str, Dict[str, Deque]] = {}
        self._callbacks: Dict[str, Callable] = {}   # symbol → coroutine to call on new bar

    # ── LIFECYCLE ─────────────────────────────────────────────────────────────

    async def connect(self):
        self._client = await AsyncClient.create(
            cfg.api_key,
            cfg.api_secret,
            testnet=cfg.testnet,
        )
        self._bsm = BinanceSocketManager(self._client)
        log.info("Binance async client connected (paper=%s testnet=%s)",
                 cfg.paper_trading, cfg.testnet)

    async def disconnect(self):
        if self._client:
            await self._client.close_connection()

    # ── HISTORICAL BOOTSTRAP ──────────────────────────────────────────────────

    async def load_history(self, symbol: str, interval: str, limit: int = BUFFER_SIZE):
        """Fetch historical klines to pre-populate the buffer before streaming."""
        klines = await self._client.futures_klines(
            symbol=symbol, interval=interval, limit=limit
        )
        buf = self._get_buf(symbol, interval)
        for k in klines:
            buf.append({
                "timestamp": pd.Timestamp(k[0], unit="ms"),
                "open":  float(k[1]),
                "high":  float(k[2]),
                "low":   float(k[3]),
                "close": float(k[4]),
                "volume":float(k[5]),
            })
        log.info("Loaded %d %s %s bars", len(buf), symbol, interval)

    # ── WEBSOCKET STREAMS ─────────────────────────────────────────────────────

    async def stream_symbol(self, symbol: str, interval: str, on_closed_bar: Callable):
        """
        Opens a WebSocket kline stream for symbol/interval.
        Calls on_closed_bar(symbol, df) whenever a bar closes.
        Auto-reconnects on disconnect.
        """
        self._callbacks[f"{symbol}_{interval}"] = on_closed_bar
        backoff = 1
        while True:
            try:
                stream = self._bsm.futures_kline_socket(symbol=symbol, interval=interval)
                async with stream as ws:
                    backoff = 1
                    async for msg in ws:
                        await self._handle_kline(msg, symbol, interval)
            except Exception as exc:
                log.warning("Stream %s/%s error: %s — retry in %ds", symbol, interval, exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _handle_kline(self, msg: dict, symbol: str, interval: str):
        k = msg.get("k", {})
        if not k:
            return

        row = {
            "timestamp": pd.Timestamp(k["t"], unit="ms"),
            "open":  float(k["o"]),
            "high":  float(k["h"]),
            "low":   float(k["l"]),
            "close": float(k["c"]),
            "volume":float(k["v"]),
        }

        buf = self._get_buf(symbol, interval)

        if k["x"]:  # bar closed
            buf.append(row)
            cb_key = f"{symbol}_{interval}"
            if cb_key in self._callbacks:
                df = self._buf_to_df(buf)
                await self._callbacks[cb_key](symbol, df)
        else:        # bar in progress — update last entry
            if buf:
                buf[-1] = row
            else:
                buf.append(row)

    def get_df(self, symbol: str, interval: str) -> pd.DataFrame:
        return self._buf_to_df(self._get_buf(symbol, interval))

    # ── ORDER PLACEMENT ───────────────────────────────────────────────────────

    async def get_balance(self) -> float:
        """Returns USDT available balance on Futures wallet."""
        if cfg.paper_trading:
            return 1000.0   # simulated balance
        balances = await self._client.futures_account_balance()
        for b in balances:
            if b["asset"] == "USDT":
                return float(b["availableBalance"])
        return 0.0

    async def place_market_order(self, symbol: str, side: str, qty: float) -> dict:
        """side: 'BUY' or 'SELL'."""
        if cfg.paper_trading:
            log.info("[PAPER] MARKET %s %s qty=%.6f", side, symbol, qty)
            return {"orderId": f"paper_{int(time.time())}", "status": "FILLED"}

        return await self._client.futures_create_order(
            symbol=symbol,
            side=side,
            type=ORDER_TYPE_MARKET,
            quantity=qty,
        )

    async def place_limit_order(self, symbol: str, side: str, qty: float, price: float) -> dict:
        """Limit order (pays maker fee 0.02% vs taker 0.04%)."""
        if cfg.paper_trading:
            log.info("[PAPER] LIMIT %s %s qty=%.6f @ %.6f", side, symbol, qty, price)
            return {"orderId": f"paper_{int(time.time())}", "status": "NEW"}

        return await self._client.futures_create_order(
            symbol=symbol,
            side=side,
            type=ORDER_TYPE_LIMIT,
            timeInForce=TIME_IN_FORCE_GTC,
            quantity=qty,
            price=price,
        )

    async def place_stop_loss(self, symbol: str, side: str, qty: float, stop_price: float) -> dict:
        """Stop-market order for SL."""
        if cfg.paper_trading:
            log.info("[PAPER] STOP-MARKET %s %s qty=%.6f stop=%.6f", side, symbol, qty, stop_price)
            return {"orderId": f"paper_{int(time.time())}", "status": "NEW"}

        return await self._client.futures_create_order(
            symbol=symbol,
            side=side,
            type=FUTURE_ORDER_TYPE_STOP_MARKET,
            stopPrice=round(stop_price, 2),
            quantity=qty,
            closePosition=False,
        )

    async def place_take_profit(self, symbol: str, side: str, qty: float, tp_price: float) -> dict:
        """Take-profit-market order."""
        if cfg.paper_trading:
            log.info("[PAPER] TP-MARKET %s %s qty=%.6f tp=%.6f", side, symbol, qty, tp_price)
            return {"orderId": f"paper_{int(time.time())}", "status": "NEW"}

        return await self._client.futures_create_order(
            symbol=symbol,
            side=side,
            type=FUTURE_ORDER_TYPE_TAKE_PROFIT_MARKET,
            stopPrice=round(tp_price, 2),
            quantity=qty,
            closePosition=False,
        )

    async def cancel_all_orders(self, symbol: str):
        if cfg.paper_trading:
            log.info("[PAPER] CANCEL ALL orders for %s", symbol)
            return
        await self._client.futures_cancel_all_open_orders(symbol=symbol)

    async def get_ticker_price(self, symbol: str) -> float:
        t = await self._client.futures_symbol_ticker(symbol=symbol)
        return float(t["price"])

    # ── HELPERS ───────────────────────────────────────────────────────────────

    def _get_buf(self, symbol: str, interval: str) -> Deque:
        self._buffers.setdefault(symbol, {})
        self._buffers[symbol].setdefault(interval, deque(maxlen=BUFFER_SIZE))
        return self._buffers[symbol][interval]

    @staticmethod
    def _buf_to_df(buf: Deque) -> pd.DataFrame:
        if not buf:
            return pd.DataFrame()
        df = pd.DataFrame(list(buf))
        df.set_index("timestamp", inplace=True)
        return df
