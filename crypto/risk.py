"""
Risk management: position sizing, daily loss tracking, kill switch.
"""

from __future__ import annotations
import os
import asyncio
from datetime import date, datetime
from dataclasses import dataclass, field
from typing import Dict
from config import cfg


@dataclass
class TradeState:
    symbol:       str
    direction:    int        # 1=long, -1=short
    entry_price:  float
    sl_price:     float
    tp1_price:    float
    tp2_price:    float
    qty:          float
    tp1_closed:   bool = False
    order_id:     str  = ""


class RiskManager:
    def __init__(self):
        self._open_trades: Dict[str, TradeState] = {}
        self._daily_pnl:   float = 0.0
        self._daily_date:  date  = date.today()
        self._lock = asyncio.Lock()

    # ── POSITION SIZING ────────────────────────────────────────────────────────

    def size_position(self, account_balance: float, entry: float, sl: float) -> float:
        """
        Risk a fixed % of account on each trade.
        qty = (account * risk_pct%) / |entry - sl|
        """
        risk_amount = account_balance * (cfg.risk_pct / 100)
        sl_dist = abs(entry - sl)
        if sl_dist == 0:
            return 0.0
        qty = risk_amount / sl_dist
        return round(qty, 6)

    # ── TRADE TRACKING ─────────────────────────────────────────────────────────

    async def can_open(self, symbol: str) -> tuple[bool, str]:
        """Returns (allowed, reason)."""
        async with self._lock:
            self._reset_daily_if_needed()

            if self._is_kill_switch_active():
                return False, "kill switch active"

            if symbol in self._open_trades:
                return False, f"already in trade on {symbol}"

            if len(self._open_trades) >= cfg.max_open_trades:
                return False, f"max open trades ({cfg.max_open_trades}) reached"

            if self._daily_pnl <= -(cfg.daily_loss_pct / 100):
                return False, f"daily loss limit hit ({self._daily_pnl:.2%})"

            return True, ""

    async def register_trade(self, state: TradeState):
        async with self._lock:
            self._open_trades[state.symbol] = state

    async def close_trade(self, symbol: str, exit_price: float, qty: float):
        async with self._lock:
            trade = self._open_trades.pop(symbol, None)
            if trade is None:
                return
            pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * trade.direction
            self._daily_pnl += pnl_pct * (qty / trade.qty)

    async def partial_close(self, symbol: str):
        """Mark TP1 as closed so we don't close it twice."""
        async with self._lock:
            if symbol in self._open_trades:
                self._open_trades[symbol].tp1_closed = True

    def get_open(self, symbol: str) -> TradeState | None:
        return self._open_trades.get(symbol)

    def open_symbols(self) -> list[str]:
        return list(self._open_trades.keys())

    # ── HELPERS ────────────────────────────────────────────────────────────────

    def _reset_daily_if_needed(self):
        today = date.today()
        if today != self._daily_date:
            self._daily_pnl  = 0.0
            self._daily_date = today

    @staticmethod
    def _is_kill_switch_active() -> bool:
        """Reads env var — same pattern the original bot used."""
        return os.getenv("KILL_SWITCH", "false").lower() == "true"

    @property
    def daily_pnl(self) -> float:
        return self._daily_pnl

    @property
    def open_count(self) -> int:
        return len(self._open_trades)
