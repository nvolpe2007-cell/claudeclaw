from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import TYPE_CHECKING

from state import load_json, save_json

if TYPE_CHECKING:
    from bot.config import Config

logger = logging.getLogger(__name__)


@dataclass
class TradeRecord:
    timestamp: float
    market_id: str
    pnl_usdc: float


class RiskManager:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._lock = Lock()
        self._daily_pnl: float = 0.0
        self._day_start: float = time.time()
        self._trade_history: list[TradeRecord] = []

    # -------------------------------------------------------------------------
    # Guards
    # -------------------------------------------------------------------------

    def can_enter(self, market_id: str, size_usdc: float) -> bool:
        with self._lock:
            self._maybe_reset_day()
            if self._daily_pnl <= -self._config.daily_loss_limit_usdc:
                logger.warning("Entry blocked: daily loss limit already breached")
                return False
            if size_usdc > self._config.order_size_usdc * 2:
                logger.warning("Entry blocked: requested size %.2f exceeds cap", size_usdc)
                return False
            return True

    def is_daily_limit_breached(self) -> bool:
        with self._lock:
            self._maybe_reset_day()
            return self._daily_pnl <= -self._config.daily_loss_limit_usdc

    # -------------------------------------------------------------------------
    # Recording
    # -------------------------------------------------------------------------

    def record_fill(self, market_id: str, pnl_usdc: float) -> None:
        with self._lock:
            self._maybe_reset_day()
            self._daily_pnl += pnl_usdc
            self._trade_history.append(TradeRecord(time.time(), market_id, pnl_usdc))
            sign = "+" if pnl_usdc >= 0 else ""
            logger.info(
                "Trade recorded: %s%.4f USDC | daily P&L: %+.4f USDC",
                sign, pnl_usdc, self._daily_pnl,
            )
            if self._daily_pnl <= -self._config.daily_loss_limit_usdc:
                logger.critical(
                    "DAILY LOSS LIMIT BREACHED: %.2f USDC — halting all trading",
                    self._daily_pnl,
                )

    def get_daily_pnl(self) -> float:
        with self._lock:
            return self._daily_pnl

    # -------------------------------------------------------------------------
    # Position sizing
    # -------------------------------------------------------------------------

    def compute_order_size(self, price_frac: float) -> float:
        """Return token quantity for a given fractional price (0–1).

        Rounds down to 2 decimal places — most Polymarket markets use 0.01
        token as minimum size.
        """
        if price_frac <= 0:
            return 0.0
        raw = self._config.order_size_usdc / price_frac
        return round(raw, 2)

    # -------------------------------------------------------------------------
    # Persistence
    # -------------------------------------------------------------------------

    def save_state(self, path: str) -> None:
        data = {
            "daily_pnl": self._daily_pnl,
            "day_start": self._day_start,
            "trades": [
                {"timestamp": t.timestamp, "market_id": t.market_id, "pnl_usdc": t.pnl_usdc}
                for t in self._trade_history
            ],
        }
        save_json(path, data)
        logger.info("Risk state saved to %s", path)

    def load_state(self, path: str) -> None:
        data = load_json(path, default=None)
        if data is None:
            return
        self._day_start = float(data.get("day_start", time.time()))
        if time.time() - self._day_start < 86400:
            self._daily_pnl = float(data.get("daily_pnl", 0.0))
        self._trade_history = [
            TradeRecord(t["timestamp"], t["market_id"], t["pnl_usdc"])
            for t in data.get("trades", [])
        ]
        logger.info("Risk state loaded: daily P&L = %+.4f USDC", self._daily_pnl)

    # -------------------------------------------------------------------------
    # Internal
    # -------------------------------------------------------------------------

    def _maybe_reset_day(self) -> None:
        if time.time() - self._day_start >= 86400:
            self._daily_pnl = 0.0
            self._day_start = time.time()
            logger.info("Daily P&L counter reset")
