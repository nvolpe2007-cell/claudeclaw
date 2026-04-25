"""
Async crypto scalping bot — Kraken.

Architecture:
- One WebSocket stream per (symbol, interval) pair, all concurrent
- Signal evaluation on every closed bar
- Orders placed async without blocking other symbol streams
- Heartbeat to DB every 30s (for watchdog workflow compatibility)
- Telegram notifications on entries/exits/daily limit

Run:
    PAPER_TRADING=true python crypto/bot.py
    PAPER_TRADING=false KRAKEN_API_KEY=... KRAKEN_API_SECRET=... python crypto/bot.py
"""

from __future__ import annotations
import asyncio
import csv
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional

import aiohttp
import pandas as pd

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from config import cfg
from exchange import ExchangeClient
from signals import compute_signal, _atr
from risk import RiskManager, TradeState

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("bot")

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRADE_LOG   = os.path.join(_SCRIPT_DIR, "..", "trades_paper.csv")


# ── TELEGRAM ──────────────────────────────────────────────────────────────────

async def send_telegram(text: str):
    if not cfg.telegram_token or not cfg.telegram_chat:
        return
    url = f"https://api.telegram.org/bot{cfg.telegram_token}/sendMessage"
    try:
        async with aiohttp.ClientSession() as session:
            await session.post(url, json={"chat_id": cfg.telegram_chat, "text": text})
    except Exception as exc:
        log.warning("Telegram send failed: %s", exc)


# ── TRADE LOG ─────────────────────────────────────────────────────────────────

def _log_trade(symbol: str, direction: int, entry: float, exit_price: float,
               pnl_pct: float, exit_reason: str):
    exists = os.path.exists(TRADE_LOG)
    try:
        with open(TRADE_LOG, "a", newline="") as f:
            w = csv.writer(f)
            if not exists:
                w.writerow(["time_utc", "symbol", "direction", "entry", "exit",
                             "pnl_pct", "exit_reason"])
            w.writerow([
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
                symbol,
                "LONG" if direction == 1 else "SHORT",
                f"{entry:.6f}",
                f"{exit_price:.6f}",
                f"{pnl_pct:.4f}",
                exit_reason,
            ])
    except Exception as exc:
        log.warning("Trade log write failed: %s", exc)


# ── HEARTBEAT ─────────────────────────────────────────────────────────────────

async def heartbeat_loop():
    """Writes last_seen to DB every N seconds — compatible with cryptoWatchdogWorkflow."""
    if not cfg.db_url:
        log.info("No DATABASE_URL — heartbeat disabled")
        return
    try:
        import psycopg2
    except ImportError:
        log.warning("psycopg2 not installed — heartbeat disabled")
        return

    while True:
        try:
            conn = psycopg2.connect(cfg.db_url)
            cur  = conn.cursor()
            cur.execute("""
                INSERT INTO bot_heartbeat (id, last_seen, metadata)
                VALUES (1, NOW(), '{"bot": "crypto-scalper"}')
                ON CONFLICT (id) DO UPDATE SET last_seen = NOW()
            """)
            conn.commit()
            cur.close()
            conn.close()
        except Exception as exc:
            log.warning("Heartbeat DB error: %s", exc)
        await asyncio.sleep(cfg.heartbeat_secs)


# ── TRADE EXECUTION ───────────────────────────────────────────────────────────

async def open_trade(symbol: str, sig, exchange: ExchangeClient, risk: RiskManager):
    """Place entry + SL + TP1 + TP2 orders."""
    allowed, reason = await risk.can_open(symbol)
    if not allowed:
        log.info("[%s] Skip: %s", symbol, reason)
        return

    balance = await exchange.get_balance()
    entry   = await exchange.get_ticker_price(symbol)
    qty     = risk.size_position(balance, entry, sig.sl_price)

    if qty <= 0:
        log.warning("[%s] Position size = 0, skipping", symbol)
        return

    entry_side = "BUY"  if sig.direction == 1 else "SELL"
    sl_side    = "SELL" if sig.direction == 1 else "BUY"
    tp_side    = "SELL" if sig.direction == 1 else "BUY"

    log.info("[%s] OPENING %s qty=%.6f entry≈%.4f SL=%.4f TP1=%.4f TP2=%.4f | %s",
             symbol, entry_side, qty, entry,
             sig.sl_price, sig.tp1_price, sig.tp2_price, sig.reason)

    tick        = entry * 0.0001
    limit_price = entry - tick if sig.direction == 1 else entry + tick
    order       = await exchange.place_limit_order(symbol, entry_side, qty, round(limit_price, 4))

    state = TradeState(
        symbol      = symbol,
        direction   = sig.direction,
        entry_price = entry,
        sl_price    = sig.sl_price,
        tp1_price   = sig.tp1_price,
        tp2_price   = sig.tp2_price,
        qty         = qty,
        order_id    = str(order.get("id", "")),
    )
    await risk.register_trade(state)

    await exchange.place_stop_loss(symbol, sl_side, qty, sig.sl_price)

    tp1_qty = round(qty * cfg.tp1_close_pct / 100, 6)
    await exchange.place_take_profit(symbol, tp_side, tp1_qty, sig.tp1_price)

    tp2_qty = round(qty - tp1_qty, 6)
    await exchange.place_take_profit(symbol, tp_side, tp2_qty, sig.tp2_price)

    await send_telegram(
        f"{'🟢' if sig.direction==1 else '🔴'} {symbol} "
        f"{'LONG' if sig.direction==1 else 'SHORT'} str={sig.strength}/5\n"
        f"Entry≈{entry:.4f}  SL={sig.sl_price:.4f}\n"
        f"TP1={sig.tp1_price:.4f}  TP2={sig.tp2_price:.4f}\n"
        f"{sig.reason}"
    )


async def check_exit(symbol: str, current_price: float, current_atr: float,
                     exchange: ExchangeClient, risk: RiskManager):
    """
    Paper-mode exit handler — called on every closed primary bar.
    In live mode the exchange handles SL/TP natively.
    After TP1: moves SL to break-even and starts trailing by 1 ATR.
    After SL hit: 15-minute cooldown before re-entering that symbol.
    """
    if not cfg.paper_trading:
        return

    trade = risk.get_open(symbol)
    if trade is None:
        return

    close_side = "SELL" if trade.direction == 1 else "BUY"
    hit_sl  = (trade.direction ==  1 and current_price <= trade.sl_price)
    hit_sl |= (trade.direction == -1 and current_price >= trade.sl_price)
    hit_tp1 = (not trade.tp1_closed and
               ((trade.direction ==  1 and current_price >= trade.tp1_price) or
                (trade.direction == -1 and current_price <= trade.tp1_price)))
    hit_tp2 = (trade.tp1_closed and
               ((trade.direction ==  1 and current_price >= trade.tp2_price) or
                (trade.direction == -1 and current_price <= trade.tp2_price)))

    if hit_sl:
        remaining = (trade.qty if not trade.tp1_closed
                     else round(trade.qty * (1 - cfg.tp1_close_pct / 100), 6))
        pnl_pct = (current_price - trade.entry_price) / trade.entry_price * trade.direction
        log.info("[%s] [PAPER] SL hit @ %.4f  pnl=%.2f%%", symbol, current_price, pnl_pct * 100)
        await exchange.place_market_order(symbol, close_side, remaining)
        _log_trade(symbol, trade.direction, trade.entry_price, current_price, pnl_pct, "SL")
        await risk.close_trade(symbol, current_price, remaining, is_sl=True)
        await send_telegram(f"🛑 {symbol} SL hit @ {current_price:.4f}  ({pnl_pct:.2%})")

    elif hit_tp1:
        tp1_qty = round(trade.qty * cfg.tp1_close_pct / 100, 6)
        pnl_pct = (current_price - trade.entry_price) / trade.entry_price * trade.direction
        log.info("[%s] [PAPER] TP1 hit @ %.4f  (closing %.0f%%)", symbol, current_price, cfg.tp1_close_pct)
        await exchange.place_market_order(symbol, close_side, tp1_qty)
        await risk.partial_close(symbol, current_price, tp1_qty)
        await risk.move_sl_to_breakeven(symbol)
        await send_telegram(
            f"✅ {symbol} TP1 @ {current_price:.4f}  ({pnl_pct:.2%})\n"
            f"SL moved to break-even — trailing remaining position"
        )

    elif hit_tp2:
        remaining = round(trade.qty * (1 - cfg.tp1_close_pct / 100), 6)
        pnl_pct = (current_price - trade.entry_price) / trade.entry_price * trade.direction
        log.info("[%s] [PAPER] TP2 hit @ %.4f  full close", symbol, current_price)
        await exchange.place_market_order(symbol, close_side, remaining)
        _log_trade(symbol, trade.direction, trade.entry_price, current_price, pnl_pct, "TP2")
        await risk.close_trade(symbol, current_price, remaining)
        await send_telegram(f"🏆 {symbol} TP2 @ {current_price:.4f}  ({pnl_pct:.2%}) — full close")

    elif trade.tp1_closed and current_atr > 0:
        # Ratchet SL toward price after TP1 — locks in gains without forcing early exit
        trail = (current_price - current_atr if trade.direction == 1
                 else current_price + current_atr)
        await risk.trail_sl(symbol, trail)


# ── PER-SYMBOL HANDLER ────────────────────────────────────────────────────────

async def _noop_bar(symbol: str, df: pd.DataFrame) -> None:
    """Placeholder callback for confirm-interval stream — buffer updates automatically."""
    pass


class SymbolHandler:
    def __init__(self, symbol: str, exchange: ExchangeClient, risk: RiskManager):
        self.symbol   = symbol
        self.exchange = exchange
        self.risk     = risk

    async def on_primary_bar(self, symbol: str, df: pd.DataFrame):
        """Called on every closed primary (1m) bar."""
        if df.empty:
            return

        current_price = float(df["close"].iat[-1])

        atr_series  = _atr(df, cfg.atr_period)
        atr_val     = float(atr_series.iat[-1])
        current_atr = atr_val if atr_val == atr_val else 0.0  # NaN guard

        await check_exit(symbol, current_price, current_atr, self.exchange, self.risk)

        if self.risk.get_open(symbol) is not None:
            return

        confirm_df = self.exchange.get_df(symbol, cfg.confirm_interval)
        sig = compute_signal(df, confirm_df if not confirm_df.empty else None)

        if sig.direction != 0 and sig.strength >= 3:
            await open_trade(symbol, sig, self.exchange, self.risk)

    async def start_streams(self):
        await asyncio.gather(
            self.exchange.stream_symbol(
                self.symbol, cfg.kline_interval, self.on_primary_bar
            ),
            self.exchange.stream_symbol(
                self.symbol, cfg.confirm_interval, _noop_bar
            ),
        )


# ── STATUS LOGGER ─────────────────────────────────────────────────────────────

async def status_loop(risk: RiskManager):
    while True:
        await asyncio.sleep(300)
        log.info("── STATUS  open=%d  daily_pnl=%.2f%%  symbols=%s",
                 risk.open_count, risk.daily_pnl * 100,
                 ", ".join(risk.open_symbols()) or "none")


# ── MAIN ──────────────────────────────────────────────────────────────────────

async def main():
    log.info("═══ Crypto Scalper Bot starting (paper=%s) ═══", cfg.paper_trading)
    log.info("Symbols: %s", cfg.symbols)
    log.info("Intervals: %sm (primary) / %sm (confirm)", cfg.kline_interval, cfg.confirm_interval)

    exchange = ExchangeClient()
    risk     = RiskManager()

    await exchange.connect()

    log.info("Loading historical bars…")
    await asyncio.gather(*[
        asyncio.gather(
            exchange.load_history(sym, cfg.kline_interval,  cfg.bars_required),
            exchange.load_history(sym, cfg.confirm_interval, cfg.bars_required),
        )
        for sym in cfg.symbols
    ])
    log.info("History loaded — streaming live data")

    handlers = [SymbolHandler(sym, exchange, risk) for sym in cfg.symbols]

    await send_telegram(
        f"🚀 Crypto Scalper started\n"
        f"Mode: {'PAPER' if cfg.paper_trading else '🔴 LIVE'}\n"
        f"Symbols: {', '.join(cfg.symbols)}\n"
        f"Signal threshold: strength ≥ 3/5"
    )

    try:
        await asyncio.gather(
            *[h.start_streams() for h in handlers],
            heartbeat_loop(),
            status_loop(risk),
        )
    except asyncio.CancelledError:
        pass
    finally:
        await exchange.disconnect()
        log.info("Bot stopped.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Interrupted by user.")
