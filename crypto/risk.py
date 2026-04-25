"""
Risk management: position sizing, daily loss tracking, kill switch, SL cooldowns.
"""

from __future__ import annotations
import os
import asyncio
from datetime import date, datetime, timedelta, timezone
from dataclasses import dataclass, field
from typing import Dict, Optional
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
        self._cooldowns:   Dict[str, datetime] = {}
        self._lock = asyncio.Lock()

    # ── POSITION SIZING ────────────────────────────────────────────────────────

    def size_position(self, account_balance: float, entry: float, sl: float) -> float:
        """qty = (account × risk_pct%) / |entry - sl|"""
        risk_amount = account_balance * (cfg.risk_pct / 100)
        sl_dist = abs(entry - sl)
        if sl_dist == 0:
            return 0.0
        return round(risk_amount / sl_dist, 6)

    # ── TRADE TRACKING ─────────────────────────────────────────────────────────

    async def can_open(self, symbol: str) -> tuple[bool, str]:
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

            until = self._cooldowns.get(symbol)
            if until and datetime.now(timezone.utc) < until:
                mins = int((until - datetime.now(timezone.utc)).total_seconds() / 60)
                return False, f"{symbol} on cooldown ({mins}m remaining after SL)"

            return True, ""

    async def register_trade(self, state: TradeState):
        async with self._lock:
            self._open_trades[state.symbol] = state

    async def close_trade(self, symbol: str, exit_price: float, qty: float,
                          is_sl: bool = False):
        async with self._lock:
            trade = self._open_trades.pop(symbol, None)
            if trade is None:
                return
            pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * trade.direction
            self._daily_pnl += pnl_pct * (qty / trade.qty)
            if is_sl:
                # 15-minute cooldown prevents revenge-trading after a stop-out
                self._cooldowns[symbol] = datetime.now(timezone.utc) + timedelta(minutes=15)

    async def partial_close(self, symbol: str, exit_price: float, closed_qty: float):
        """Record TP1 PnL and mark position as partially closed."""
        async with self._lock:
            trade = self._open_trades.get(symbol)
            if trade is None:
                return
            trade.tp1_closed = True
            pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * trade.direction
            self._daily_pnl += pnl_pct * (closed_qty / trade.qty)

    async def move_sl_to_breakeven(self, symbol: str):
        """Move stop-loss to entry after TP1 — worst case is now break-even."""
        async with self._lock:
            trade = self._open_trades.get(symbol)
            if trade:
                trade.sl_price = trade.entry_price

    async def trail_sl(self, symbol: str, new_sl: float):
        """Ratchet SL toward current price — only moves in profit direction, never back."""
        async with self._lock:
            trade = self._open_trades.get(symbol)
            if trade is None or not trade.tp1_closed:
                return
            if trade.direction == 1:
                trade.sl_price = max(trade.sl_price, new_sl)
            else:
                trade.sl_price = min(trade.sl_price, new_sl)

    def get_open(self, symbol: str) -> Optional[TradeState]:
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
        return os.getenv("KILL_SWITCH", "false").lower() == "true"

    @property
    def daily_pnl(self) -> float:
        return self._daily_pnl

    @property
    def open_count(self) -> int:
        return len(self._open_trades)
