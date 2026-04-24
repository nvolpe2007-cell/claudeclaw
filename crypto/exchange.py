"""
Kraken async exchange client.
- WebSocket for real-time OHLC data (wss://ws.kraken.com)
- ccxt async for order placement (handles Kraken API signing)
- Auto-reconnect with exponential backoff
- Paper-trading mode: logs orders instead of sending them
"""

from __future__ import annotations
import asyncio
import json
import logging
import time
from collections import deque
from typing import Callable, Dict, Deque, Optional

import pandas as pd
import ccxt.async_support as ccxt
import websockets

from config import cfg

log = logging.getLogger(__name__)

KRAKEN_WS_URL  = "wss://ws.kraken.com"
KRAKEN_REST    = "https://api.kraken.com"
BUFFER_SIZE    = 220

# Kraken REST uses different pair names than WS (e.g. XXBTZUSD vs XBT/USD)
# ccxt normalises this automatically using the "XBT/USD" format
_PAIR_WS_FORMAT = {
    "XBT/USD": "XBT/USD",
    "ETH/USD": "ETH/USD",
    "SOL/USD": "SOL/USD",
    "XRP/USD": "XRP/USD",
    "ADA/USD": "ADA/USD",
    "DOT/USD": "DOT/USD",
    "MATIC/USD": "MATIC/USD",
    "LINK/USD": "LINK/USD",
}


class ExchangeClient:
    def __init__(self):
        self._kraken: Optional[ccxt.kraken] = None
        self._buffers: Dict[str, Dict[int, Deque]] = {}   # symbol → interval → deque
        self._callbacks: Dict[str, Callable] = {}

    # ── LIFECYCLE ─────────────────────────────────────────────────────────────

    async def connect(self):
        self._kraken = ccxt.kraken({
            "apiKey":  cfg.api_key,
            "secret":  cfg.api_secret,
            "enableRateLimit": True,
        })
        # Validate keys by loading markets (also populates symbol info)
        await self._kraken.load_markets()
        log.info("Kraken connected (paper=%s)", cfg.paper_trading)

    async def disconnect(self):
        if self._kraken:
            await self._kraken.close()

    # ── HISTORICAL BOOTSTRAP ──────────────────────────────────────────────────

    async def load_history(self, symbol: str, interval: int, limit: int = BUFFER_SIZE):
        """Fetch historical OHLCV via REST to pre-populate buffers."""
        tf = f"{interval}m"
        try:
            ohlcv = await self._kraken.fetch_ohlcv(symbol, timeframe=tf, limit=limit)
        except Exception as exc:
            log.warning("History fetch failed for %s/%s: %s", symbol, tf, exc)
            return

        buf = self._get_buf(symbol, interval)
        for row in ohlcv:
            ts, o, h, l, c, v = row
            buf.append({
                "timestamp": pd.Timestamp(ts, unit="ms"),
                "open":   float(o),
                "high":   float(h),
                "low":    float(l),
                "close":  float(c),
                "volume": float(v),
            })
        log.info("Loaded %d %s %sm bars", len(buf), symbol, interval)

    # ── WEBSOCKET STREAMS ─────────────────────────────────────────────────────

    async def stream_symbol(self, symbol: str, interval: int, on_closed_bar: Callable):
        """
        Streams OHLC data from Kraken WebSocket.
        on_closed_bar(symbol, df) is called on every completed bar.
        Auto-reconnects on disconnect.
        """
        key = f"{symbol}_{interval}"
        self._callbacks[key] = on_closed_bar
        backoff = 1

        while True:
            try:
                async with websockets.connect(KRAKEN_WS_URL, ping_interval=30) as ws:
                    sub_msg = json.dumps({
                        "event": "subscribe",
                        "pair":  [_PAIR_WS_FORMAT.get(symbol, symbol)],
                        "subscription": {
                            "name":     "ohlc",
                            "interval": interval,
                        },
                    })
                    await ws.send(sub_msg)
                    log.info("Subscribed to %s OHLC %sm", symbol, interval)
                    backoff = 1

                    async for raw in ws:
                        await self._handle_ohlc(raw, symbol, interval)

            except websockets.ConnectionClosed as exc:
                log.warning("WS %s/%sm closed (%s) — retry in %ds", symbol, interval, exc, backoff)
            except Exception as exc:
                log.warning("WS %s/%sm error: %s — retry in %ds", symbol, interval, exc, backoff)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def _handle_ohlc(self, raw: str, symbol: str, interval: int):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        # Skip event messages (heartbeat, subscriptionStatus, etc.)
        if isinstance(msg, dict):
            return

        # OHLC message format:
        # [channelID, [time, etime, open, high, low, close, vwap, volume, count], "ohlc-N", "PAIR"]
        if not isinstance(msg, list) or len(msg) < 4:
            return

        channel = msg[2] if len(msg) > 2 else ""
        if not isinstance(channel, str) or not channel.startswith("ohlc"):
            return

        data = msg[1]
        if not isinstance(data, list) or len(data) < 8:
            return

        try:
            # Kraken OHLC: [time, etime, open, high, low, close, vwap, volume, count]
            bar_end_time = float(data[1])   # etime = bar end timestamp
            row = {
                "timestamp": pd.Timestamp(float(data[0]), unit="s"),
                "open":   float(data[2]),
                "high":   float(data[3]),
                "low":    float(data[4]),
                "close":  float(data[5]),
                "volume": float(data[7]),
            }
        except (IndexError, ValueError):
            return

        buf = self._get_buf(symbol, interval)
        now_ts = time.time()
        bar_end = bar_end_time

        # Detect closed bar: current time is past this bar's end time
        is_closed = now_ts >= bar_end

        if buf and buf[-1]["timestamp"] == row["timestamp"]:
            buf[-1] = row     # update in-progress bar
        else:
            buf.append(row)   # new bar

        if is_closed:
            key = f"{symbol}_{interval}"
            if key in self._callbacks:
                df = self._buf_to_df(buf)
                await self._callbacks[key](symbol, df)

    def get_df(self, symbol: str, interval: int) -> pd.DataFrame:
        return self._buf_to_df(self._get_buf(symbol, interval))

    # ── ORDER PLACEMENT ───────────────────────────────────────────────────────

    async def get_balance(self) -> float:
        """Returns USD available balance."""
        if cfg.paper_trading:
            return 1000.0
        try:
            bal = await self._kraken.fetch_balance()
            return float(bal.get("USD", {}).get("free", 0))
        except Exception as exc:
            log.error("Balance fetch failed: %s", exc)
            return 0.0

    async def get_ticker_price(self, symbol: str) -> float:
        try:
            ticker = await self._kraken.fetch_ticker(symbol)
            return float(ticker["last"])
        except Exception as exc:
            log.error("Ticker fetch failed for %s: %s", symbol, exc)
            return 0.0

    async def place_market_order(self, symbol: str, side: str, qty: float) -> dict:
        if cfg.paper_trading:
            log.info("[PAPER] MARKET %s %s qty=%.6f", side, symbol, qty)
            return {"id": f"paper_{int(time.time())}", "status": "closed"}
        try:
            return await self._kraken.create_order(symbol, "market", side.lower(), qty)
        except Exception as exc:
            log.error("Market order failed %s %s: %s", side, symbol, exc)
            return {}

    async def place_limit_order(self, symbol: str, side: str, qty: float, price: float) -> dict:
        if cfg.paper_trading:
            log.info("[PAPER] LIMIT %s %s qty=%.6f @ %.4f", side, symbol, qty, price)
            return {"id": f"paper_{int(time.time())}", "status": "open"}
        try:
            return await self._kraken.create_order(symbol, "limit", side.lower(), qty, price)
        except Exception as exc:
            log.error("Limit order failed %s %s: %s", side, symbol, exc)
            return {}

    async def place_stop_loss(self, symbol: str, side: str, qty: float, stop_price: float) -> dict:
        """Kraken stop-loss order."""
        if cfg.paper_trading:
            log.info("[PAPER] STOP-LOSS %s %s qty=%.6f stop=%.4f", side, symbol, qty, stop_price)
            return {"id": f"paper_{int(time.time())}"}
        try:
            return await self._kraken.create_order(
                symbol, "stop-loss", side.lower(), qty,
                params={"stopLossPrice": stop_price}
            )
        except Exception as exc:
            log.error("Stop-loss order failed %s %s: %s", side, symbol, exc)
            return {}

    async def place_take_profit(self, symbol: str, side: str, qty: float, tp_price: float) -> dict:
        """Kraken take-profit order."""
        if cfg.paper_trading:
            log.info("[PAPER] TAKE-PROFIT %s %s qty=%.6f tp=%.4f", side, symbol, qty, tp_price)
            return {"id": f"paper_{int(time.time())}"}
        try:
            return await self._kraken.create_order(
                symbol, "take-profit", side.lower(), qty,
                params={"takeProfitPrice": tp_price}
            )
        except Exception as exc:
            log.error("Take-profit order failed %s %s: %s", side, symbol, exc)
            return {}

    async def cancel_all_orders(self, symbol: str):
        if cfg.paper_trading:
            log.info("[PAPER] CANCEL ALL orders for %s", symbol)
            return
        try:
            await self._kraken.cancel_all_orders(symbol)
        except Exception as exc:
            log.error("Cancel orders failed for %s: %s", symbol, exc)

    # ── HELPERS ───────────────────────────────────────────────────────────────

    def _get_buf(self, symbol: str, interval: int) -> Deque:
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
