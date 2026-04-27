"""Live BTC/USDT price feed via Binance public REST API (no auth required)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.request
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_TICKER_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
_KLINES_URL = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=15"


@dataclass
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class BtcSnapshot:
    price: float
    candles_1m: list[Candle]
    fetched_at: float


class BtcPriceFeed:
    """Polls Binance public API for BTC/USDT spot price and recent 1-minute candles."""

    def __init__(self) -> None:
        self._snapshot: Optional[BtcSnapshot] = None
        self._lock = asyncio.Lock()

    async def refresh(self) -> BtcSnapshot:
        async with self._lock:
            loop = asyncio.get_running_loop()
            snap = await loop.run_in_executor(None, self._fetch_sync)
            self._snapshot = snap
            return snap

    def latest(self) -> Optional[BtcSnapshot]:
        return self._snapshot

    def _fetch_sync(self) -> BtcSnapshot:
        with urllib.request.urlopen(_TICKER_URL, timeout=5) as resp:
            price = float(json.loads(resp.read())["price"])

        with urllib.request.urlopen(_KLINES_URL, timeout=5) as resp:
            raw = json.loads(resp.read())

        candles = [
            Candle(
                open_time=int(k[0]),
                open=float(k[1]),
                high=float(k[2]),
                low=float(k[3]),
                close=float(k[4]),
                volume=float(k[5]),
            )
            for k in raw
        ]
        return BtcSnapshot(price=price, candles_1m=candles, fetched_at=time.time())
