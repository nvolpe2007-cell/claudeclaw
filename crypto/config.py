import os
from dataclasses import dataclass, field
from typing import List
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    # ── Exchange ───────────────────────────────────────────────────────────────
    api_key:         str   = field(default_factory=lambda: os.getenv("BINANCE_API_KEY", ""))
    api_secret:      str   = field(default_factory=lambda: os.getenv("BINANCE_API_SECRET", ""))
    paper_trading:   bool  = field(default_factory=lambda: os.getenv("PAPER_TRADING", "true").lower() == "true")
    testnet:         bool  = field(default_factory=lambda: os.getenv("BINANCE_TESTNET", "false").lower() == "true")

    # ── Symbols to scan ────────────────────────────────────────────────────────
    symbols: List[str] = field(default_factory=lambda: [
        s.strip() for s in
        os.getenv("SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT").split(",")
    ])

    # ── Signal parameters (match Pine Script lux_signals defaults) ─────────────
    ema_fast:        int   = int(os.getenv("EMA_FAST",   "20"))
    ema_slow:        int   = int(os.getenv("EMA_SLOW",   "50"))
    ema_trend:       int   = int(os.getenv("EMA_TREND",  "200"))
    st_factor:       float = float(os.getenv("ST_FACTOR", "3.0"))
    st_period:       int   = int(os.getenv("ST_PERIOD",  "10"))
    rsi_period:      int   = int(os.getenv("RSI_PERIOD", "14"))
    rsi_ob:          int   = int(os.getenv("RSI_OB",     "70"))
    rsi_os:          int   = int(os.getenv("RSI_OS",     "30"))
    adx_period:      int   = int(os.getenv("ADX_PERIOD", "14"))
    adx_min:         float = float(os.getenv("ADX_MIN",  "20"))
    atr_period:      int   = int(os.getenv("ATR_PERIOD", "14"))
    atr_lo_mult:     float = float(os.getenv("ATR_LO",   "0.5"))
    atr_hi_mult:     float = float(os.getenv("ATR_HI",   "3.0"))
    ext_max_atr:     float = float(os.getenv("EXT_MAX",  "2.0"))

    # ── Risk management ────────────────────────────────────────────────────────
    risk_pct:        float = float(os.getenv("RISK_PCT",      "1.0"))   # % of account per trade
    sl_atr:          float = float(os.getenv("SL_ATR",        "1.5"))   # SL distance in ATRs
    tp1_atr:         float = float(os.getenv("TP1_ATR",       "1.5"))   # TP1 in ATRs
    tp2_atr:         float = float(os.getenv("TP2_ATR",       "3.5"))   # TP2 in ATRs
    tp1_close_pct:   float = float(os.getenv("TP1_CLOSE_PCT", "50"))    # % to close at TP1
    daily_loss_pct:  float = float(os.getenv("DAILY_LOSS_PCT","3.0"))   # max daily loss %
    max_open_trades: int   = int(os.getenv("MAX_OPEN_TRADES", "3"))     # across all symbols

    # ── Timing ─────────────────────────────────────────────────────────────────
    kline_interval:  str   = os.getenv("KLINE_INTERVAL", "1m")          # primary TF
    confirm_interval:str   = os.getenv("CONFIRM_INTERVAL", "5m")        # trend-filter TF
    bars_required:   int   = int(os.getenv("BARS_REQUIRED", "210"))     # min bars before trading

    # ── Notifications ──────────────────────────────────────────────────────────
    telegram_token:  str   = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_chat:   str   = os.getenv("TELEGRAM_CHAT_ID", "")

    # ── Heartbeat ──────────────────────────────────────────────────────────────
    db_url:          str   = os.getenv("DATABASE_URL", "")
    heartbeat_secs:  int   = int(os.getenv("HEARTBEAT_SECS", "30"))


cfg = Config()
