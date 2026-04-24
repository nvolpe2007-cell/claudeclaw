"""
Signal logic — Python port of lux_signals.pine + smc_suite.pine filters.

All indicators are computed from a pandas DataFrame with columns:
  open, high, low, close, volume  (float64, indexed by timestamp)

Returns a SignalResult dataclass so callers don't need to unpack dicts.
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
    strength:    int    # 1–3 (filters passed)
    atr:         float
    sl_price:    float
    tp1_price:   float
    tp2_price:   float
    reason:      str    # human-readable summary


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
    """Returns (supertrend_series, direction_series) where direction -1=bull, 1=bear."""
    atr    = _atr(df, period)
    hl2    = (df["high"] + df["low"]) / 2
    upper  = hl2 + factor * atr
    lower  = hl2 - factor * atr

    st     = pd.Series(np.nan, index=df.index)
    direction = pd.Series(1, index=df.index)

    for i in range(1, len(df)):
        prev_st  = st.iat[i - 1]
        prev_dir = direction.iat[i - 1]
        cl       = df["close"].iat[i]

        # Lower band: floor at previous lower if previous direction was bull
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


# ── MAIN SIGNAL FUNCTION ───────────────────────────────────────────────────────

def compute_signal(df: pd.DataFrame, confirm_df: Optional[pd.DataFrame] = None) -> SignalResult:
    """
    df:          1m OHLCV bars (primary TF)
    confirm_df:  5m OHLCV bars (trend filter TF) — optional but recommended
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

    # Current-bar values (last row)
    i         = -1
    cur_close = c.iat[i]
    cur_ema_f = ema_f.iat[i]
    cur_ema_s = ema_s.iat[i]
    cur_ema_t = ema_t.iat[i]
    cur_rsi   = rsi.iat[i]
    cur_atr   = atr.iat[i]
    cur_atr_avg = atr_avg.iat[i]
    cur_adx   = adx.iat[i]
    cur_st    = st.iat[i]
    cur_dir   = st_dir.iat[i]
    prev_dir  = st_dir.iat[i - 1]

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
        htf_bull  = htf_ema_f > htf_ema_s > htf_ema_t
        htf_bear  = htf_ema_f < htf_ema_s < htf_ema_t

    # ── FILTER EVALUATION ───────────────────────────────────────────────────
    # ADX: skip ranging markets
    adx_ok = cur_adx > cfg.adx_min

    # ATR volatility gate: skip dead periods and news spikes
    atr_ok = (not np.isnan(cur_atr_avg) and
              cur_atr_avg > 0 and
              cfg.atr_lo_mult <= (cur_atr / cur_atr_avg) <= cfg.atr_hi_mult)

    # Extension filter: don't enter when price is too far from Supertrend
    ext_ok = abs(cur_close - cur_st) < cur_atr * cfg.ext_max_atr

    # RSI slope over 2 bars
    rsi_slope_bull = rsi.iat[-1] > rsi.iat[-3]
    rsi_slope_bear = rsi.iat[-1] < rsi.iat[-3]

    # 1m EMA trend alignment
    ema_bull_1m = cur_ema_f > cur_ema_s > cur_ema_t
    ema_bear_1m = cur_ema_f < cur_ema_s < cur_ema_t

    # Supertrend direction
    st_bull = cur_dir == -1
    st_bear = cur_dir ==  1

    # Supertrend flip this bar
    st_flip_bull = st_bull and prev_dir != -1
    st_flip_bear = st_bear and prev_dir !=  1

    # EMA crossover this bar
    ema_x_bull = (c.iat[-2] <= ema_f.iat[-2]) and (cur_close > cur_ema_f)
    ema_x_bear = (c.iat[-2] >= ema_f.iat[-2]) and (cur_close < cur_ema_f)

    trend_bull = st_bull and ema_bull_1m and htf_bull
    trend_bear = st_bear and ema_bear_1m and htf_bear

    # ── SIGNAL CONDITIONS ───────────────────────────────────────────────────
    raw_bull = ((st_flip_bull or ema_x_bull) and
                trend_bull and
                cur_rsi > cfg.rsi_os and cur_rsi < cfg.rsi_ob and
                rsi_slope_bull)

    raw_bear = ((st_flip_bear or ema_x_bear) and
                trend_bear and
                cur_rsi < cfg.rsi_ob and cur_rsi > cfg.rsi_os and
                rsi_slope_bear)

    all_filters = adx_ok and atr_ok and ext_ok

    long_signal  = raw_bull and all_filters
    short_signal = raw_bear and all_filters

    if not long_signal and not short_signal:
        return _none

    # ── STRENGTH SCORING (1–3) ───────────────────────────────────────────────
    direction = 1 if long_signal else -1
    score = 1
    if adx_ok and atr_ok:
        score += 1
    if ext_ok and (htf_bull if direction == 1 else htf_bear):
        score += 1

    # ── PRICE LEVELS ────────────────────────────────────────────────────────
    sl_dist  = cur_atr * cfg.sl_atr
    tp1_dist = cur_atr * cfg.tp1_atr
    tp2_dist = cur_atr * cfg.tp2_atr

    if direction == 1:
        sl   = cur_close - sl_dist
        tp1  = cur_close + tp1_dist
        tp2  = cur_close + tp2_dist
    else:
        sl   = cur_close + sl_dist
        tp1  = cur_close - tp1_dist
        tp2  = cur_close - tp2_dist

    reason = (f"{'LONG' if direction==1 else 'SHORT'} str={score} "
              f"ADX={cur_adx:.1f} RSI={cur_rsi:.1f} ATR={cur_atr:.6f} "
              f"{'ST-flip' if (st_flip_bull or st_flip_bear) else 'EMA-X'}")

    return SignalResult(direction, score, cur_atr, sl, tp1, tp2, reason)
