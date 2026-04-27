import os
import dataclasses
from dataclasses import dataclass, field
from typing import List
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    # ── Exchange (Kraken) ──────────────────────────────────────────────────────
    api_key:         str   = field(default_factory=lambda: os.getenv("KRAKEN_API_KEY", ""))
    api_secret:      str   = field(default_factory=lambda: os.getenv("KRAKEN_API_SECRET", ""))
    paper_trading:   bool  = field(default_factory=lambda: os.getenv("PAPER_TRADING", "true").lower() == "true")

    # Kraken symbol format: "XBT/USD" (BTC), "ETH/USD", "SOL/USD", "XRP/USD"
    # Note: Kraken uses XBT for Bitcoin, not BTC
    symbols: List[str] = field(default_factory=lambda: [
        s.strip() for s in
        os.getenv("SYMBOLS", "XBT/USD,ETH/USD,SOL/USD,XRP/USD").split(",")
    ])

    # Meme coin symbols get a separate tuned parameter profile (lower risk, wider ATR gates)
    meme_symbols: List[str] = field(default_factory=lambda: [
        s.strip() for s in
        os.getenv("MEME_SYMBOLS", "DOGE/USD,SHIB/USD,PEPE/USD,FLOKI/USD").split(",")
        if s.strip()
    ])

    # ── Signal parameters ─────────────────────────────────────────────────────
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

    # ── Risk management ───────────────────────────────────────────────────────
    risk_pct:        float = float(os.getenv("RISK_PCT",      "1.0"))
    sl_atr:          float = float(os.getenv("SL_ATR",        "1.5"))
    tp1_atr:         float = float(os.getenv("TP1_ATR",       "1.5"))
    tp2_atr:         float = float(os.getenv("TP2_ATR",       "3.5"))
    tp1_close_pct:   float = float(os.getenv("TP1_CLOSE_PCT", "50"))
    daily_loss_pct:  float = float(os.getenv("DAILY_LOSS_PCT","3.0"))
    max_open_trades: int   = int(os.getenv("MAX_OPEN_TRADES", "3"))

    # ── Timing ────────────────────────────────────────────────────────────────
    # Kraken WS interval options (minutes): 1,5,15,30,60,240,1440,10080,21600
    kline_interval:   int  = int(os.getenv("KLINE_INTERVAL",   "1"))   # 1m primary
    confirm_interval: int  = int(os.getenv("CONFIRM_INTERVAL", "5"))   # 5m trend filter
    bars_required:    int  = int(os.getenv("BARS_REQUIRED",    "210"))

    # ── Notifications ─────────────────────────────────────────────────────────
    telegram_token:  str   = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_chat:   str   = os.getenv("TELEGRAM_CHAT_ID", "")

    # ── Heartbeat ─────────────────────────────────────────────────────────────
    db_url:          str   = os.getenv("DATABASE_URL", "")
    heartbeat_secs:  int   = int(os.getenv("HEARTBEAT_SECS", "30"))

    def is_meme(self, symbol: str) -> bool:
        return symbol in self.meme_symbols

    def meme_cfg(self) -> "Config":
        """Return a copy of this config with parameters tuned for meme coin volatility."""
        return dataclasses.replace(
            self,
            adx_min      = 12.0,   # meme markets are choppier
            atr_lo_mult  = 0.3,    # allow low-volatility accumulation periods
            atr_hi_mult  = 6.0,    # meme spikes can be extreme
            sl_atr       = 2.0,    # wider stop to survive noise
            tp1_atr      = 2.0,    # take partial profit faster on spikes
            tp2_atr      = 5.0,    # let runners run — meme pumps extend far
            ext_max_atr  = 3.0,    # memes extend well beyond normal limits
            risk_pct     = 0.5,    # half position size for gap/rug risk
        )


cfg = Config()
