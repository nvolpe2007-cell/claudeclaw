"""
Signal logic — upgraded scalping signals.

Indicators: EMA cloud, Supertrend, RSI, ADX, ATR, daily VWAP, StochRSI, volume
Hard filters (required): ADX > 20, ATR gate
Quality score (0-5): extension, HTF trend, VWAP, volume surge, StochRSI
Require score >= 3 to trade.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import Optional
from config import cfg


@dataclass
class SignalResult:
    direction:   int    # 1 = long, -1 = short, 0 = no signal
    strength:    int    # 0–5
    atr:         float
    sl_price:    float
    tp1_price:   float
    tp2_price:   float
    reason:      str


# ── INDICATOR HELPERS ──────────────────────────────────────────────────────────

def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def _rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _atr(df: pd.DataFrame, period: int) -> pd.Series:
    high, low, prev_close = df["high"], df["low"], df["close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(com=period - 1, adjust=False).mean()


def _adx(df: pd.DataFrame, period: int) -> pd.Series:
    """Wilder-smoothed ADX (matches TradingView ta.dmi)."""
    high, low = df["high"], df["low"]
    prev_high = high.shift(1)
    prev_low  = low.shift(1)

    plus_dm  = np.where((high - prev_high) > (prev_low - low),
                        np.maximum(high - prev_high, 0), 0)
    minus_dm = np.where((prev_low - low) > (high - prev_high),
                        np.maximum(prev_low - low, 0), 0)

    atr_raw = _atr(df, period)

    def _wilder(arr):
        s = pd.Series(arr, index=df.index)
        return s.ewm(com=period - 1, adjust=False).mean()

    plus_di  = 100 * _wilder(plus_dm)  / atr_raw.replace(0, np.nan)
    minus_di = 100 * _wilder(minus_dm) / atr_raw.replace(0, np.nan)
    dx = (100 * (plus_di - minus_di).abs() /
          (plus_di + minus_di).replace(0, np.nan))
    return dx.ewm(com=period - 1, adjust=False).mean()


def _supertrend(df: pd.DataFrame, factor: float, period: int):
    """Returns (supertrend_series, direction_series) — direction -1=bull, 1=bear."""
    atr    = _atr(df, period)
    hl2    = (df["high"] + df["low"]) / 2
    upper  = hl2 + factor * atr
    lower  = hl2 - factor * atr

    st        = pd.Series(np.nan, index=df.index)
    direction = pd.Series(1, index=df.index)

    for i in range(1, len(df)):
        prev_st  = st.iat[i - 1]
        prev_dir = direction.iat[i - 1]
        cl       = df["close"].iat[i]

        lb = lower.iat[i]
        ub = upper.iat[i]
        if not np.isnan(prev_st):
            if prev_dir == -1:
                lb = max(lb, st.iat[i - 1])
            else:
                ub = min(ub, st.iat[i - 1])

        if prev_dir == 1 and cl > ub:
            direction.iat[i] = -1
            st.iat[i] = lb
        elif prev_dir == -1 and cl < lb:
            direction.iat[i] = 1
            st.iat[i] = ub
        else:
            direction.iat[i] = prev_dir
            st.iat[i] = lb if prev_dir == -1 else ub

    return st, direction


def _vwap(df: pd.DataFrame) -> pd.Series:
    """Daily-anchored VWAP — resets at midnight UTC."""
    typical = (df["high"] + df["low"] + df["close"]) / 3
    result  = pd.Series(np.nan, index=df.index)
    for d in df.index.normalize().unique():
        mask    = df.index.normalize() == d
        vol     = df.loc[mask, "volume"]
        cum_vol = vol.cumsum()
        result.loc[mask] = (typical.loc[mask] * vol).cumsum() / cum_vol.replace(0, np.nan)
    return result


def _stoch_rsi(rsi: pd.Series, period: int = 14, k_smooth: int = 3, d_smooth: int = 3):
    """StochRSI K and D lines (0–100 scale)."""
    lo  = rsi.rolling(period).min()
    hi  = rsi.rolling(period).max()
    raw = (rsi - lo) / (hi - lo).replace(0, np.nan) * 100
    k   = raw.rolling(k_smooth).mean()
    d   = k.rolling(d_smooth).mean()
    return k, d


# ── MAIN SIGNAL FUNCTION ───────────────────────────────────────────────────────

def compute_signal(df: pd.DataFrame, confirm_df: Optional[pd.DataFrame] = None) -> SignalResult:
    """
    df:          primary TF OHLCV (1m)
    confirm_df:  higher TF OHLCV (5m) for trend filter
    """
    _none = SignalResult(0, 0, 0.0, 0.0, 0.0, 0.0, "")

    if len(df) < cfg.bars_required:
        return _none

    c = df["close"]

    # ── INDICATORS ──────────────────────────────────────────────────────────
    ema_f  = _ema(c, cfg.ema_fast)
    ema_s  = _ema(c, cfg.ema_slow)
    ema_t  = _ema(c, cfg.ema_trend)
    rsi    = _rsi(c, cfg.rsi_period)
    atr    = _atr(df, cfg.atr_period)
    atr_avg = atr.rolling(20).mean()
    adx    = _adx(df, cfg.adx_period)
    st, st_dir = _supertrend(df, cfg.st_factor, cfg.st_period)
    vwap   = _vwap(df)
    vol_avg = df["volume"].rolling(20).mean()
    srsi_k, _ = _stoch_rsi(rsi)

    i = -1
    cur_close   = c.iat[i]
    cur_ema_f   = ema_f.iat[i]
    cur_ema_s   = ema_s.iat[i]
    cur_ema_t   = ema_t.iat[i]
    cur_rsi     = rsi.iat[i]
    cur_atr     = atr.iat[i]
    cur_atr_avg = atr_avg.iat[i]
    cur_adx     = adx.iat[i]
    cur_st      = st.iat[i]
    cur_dir     = st_dir.iat[i]
    prev_dir    = st_dir.iat[i - 1]
    cur_vwap    = vwap.iat[i]
    cur_vol     = df["volume"].iat[i]
    cur_vol_avg = vol_avg.iat[i]
    cur_srsi_k  = srsi_k.iat[i]

    if np.isnan(cur_atr) or np.isnan(cur_adx) or np.isnan(cur_st):
        return _none

    # ── HIGHER-TF TREND FILTER ───────────────────────────────────────────────
    htf_bull = True
    htf_bear = True
    if confirm_df is not None and len(confirm_df) >= cfg.ema_trend:
        htf_c     = confirm_df["close"]
        htf_ema_f = _ema(htf_c, cfg.ema_fast).iat[-1]
        htf_ema_s = _ema(htf_c, cfg.ema_slow).iat[-1]
        htf_ema_t = _ema(htf_c, cfg.ema_trend).iat[-1]
        if not any(np.isnan(v) for v in [htf_ema_f, htf_ema_s, htf_ema_t]):
            htf_bull = htf_ema_f > htf_ema_s > htf_ema_t
            htf_bear = htf_ema_f < htf_ema_s < htf_ema_t

    # ── HARD FILTERS (signal aborted if either fails) ────────────────────────
    adx_ok = cur_adx > cfg.adx_min
    atr_ok = (not np.isnan(cur_atr_avg) and
              cur_atr_avg > 0 and
              cfg.atr_lo_mult <= (cur_atr / cur_atr_avg) <= cfg.atr_hi_mult)

    if not adx_ok or not atr_ok:
        return _none

    # ── EMA + SUPERTREND ALIGNMENT ───────────────────────────────────────────
    ema_bull_1m  = cur_ema_f > cur_ema_s > cur_ema_t
    ema_bear_1m  = cur_ema_f < cur_ema_s < cur_ema_t
    st_bull      = cur_dir == -1
    st_bear      = cur_dir ==  1
    st_flip_bull = st_bull and prev_dir != -1
    st_flip_bear = st_bear and prev_dir !=  1
    ema_x_bull   = (c.iat[-2] <= ema_f.iat[-2]) and (cur_close > cur_ema_f)
    ema_x_bear   = (c.iat[-2] >= ema_f.iat[-2]) and (cur_close < cur_ema_f)

    rsi_slope_bull = rsi.iat[-1] > rsi.iat[-3]
    rsi_slope_bear = rsi.iat[-1] < rsi.iat[-3]

    raw_bull = ((st_flip_bull or ema_x_bull) and
                st_bull and ema_bull_1m and
                cur_rsi > cfg.rsi_os and cur_rsi < cfg.rsi_ob and
                rsi_slope_bull)
    raw_bear = ((st_flip_bear or ema_x_bear) and
                st_bear and ema_bear_1m and
                cur_rsi < cfg.rsi_ob and cur_rsi > cfg.rsi_os and
                rsi_slope_bear)

    if not raw_bull and not raw_bear:
        return _none

    direction = 1 if raw_bull else -1

    # ── QUALITY SCORE (0–5, need ≥ 3) ───────────────────────────────────────
    # Extension: not overextended from Supertrend
    ext_ok = abs(cur_close - cur_st) < cur_atr * cfg.ext_max_atr

    # Higher-TF trend aligned
    htf_align = htf_bull if direction == 1 else htf_bear

    # Price on correct side of daily VWAP (institutional anchor)
    vwap_ok = (not np.isnan(cur_vwap) and
               (cur_close > cur_vwap if direction == 1 else cur_close < cur_vwap))

    # Volume surge: confirms conviction behind the move
    vol_surge = (not np.isnan(cur_vol_avg) and cur_vol_avg > 0 and
                 cur_vol >= cur_vol_avg * 1.2)

    # StochRSI not already extended in signal direction (avoids chasing)
    srsi_ok = (np.isnan(cur_srsi_k) or
               (cur_srsi_k < 70 if direction == 1 else cur_srsi_k > 30))

    score = sum([ext_ok, htf_align, vwap_ok, vol_surge, srsi_ok])

    if score < 3:
        return _none

    # ── PRICE LEVELS ────────────────────────────────────────────────────────
    sl_dist  = cur_atr * cfg.sl_atr
    tp1_dist = cur_atr * cfg.tp1_atr
    tp2_dist = cur_atr * cfg.tp2_atr

    if direction == 1:
        sl  = cur_close - sl_dist
        tp1 = cur_close + tp1_dist
        tp2 = cur_close + tp2_dist
    else:
        sl  = cur_close + sl_dist
        tp1 = cur_close - tp1_dist
        tp2 = cur_close - tp2_dist

    srsi_str = f"{cur_srsi_k:.0f}" if not np.isnan(cur_srsi_k) else "n/a"
    reason = (
        f"{'LONG' if direction==1 else 'SHORT'} str={score}/5 "
        f"ADX={cur_adx:.1f} RSI={cur_rsi:.1f} SRSI={srsi_str} "
        f"VWAP={'✓' if vwap_ok else '✗'} VOL={'✓' if vol_surge else '✗'} "
        f"{'ST-flip' if (st_flip_bull or st_flip_bear) else 'EMA-X'}"
    )

    return SignalResult(direction, score, cur_atr, sl, tp1, tp2, reason)
