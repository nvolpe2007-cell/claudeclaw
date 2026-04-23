from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv


@dataclass
class Config:
    # API connection
    clob_api_url: str
    clob_api_key: str
    clob_secret: str
    clob_passphrase: str
    private_key: str

    # Market selection
    max_concurrent_markets: int = 10
    min_spread_cents: float = 2.0
    min_volume_usd: float = 50_000.0
    min_price_cents: float = 5.0
    max_price_cents: float = 95.0

    # Order sizing
    order_size_usdc: float = 25.0

    # Profit/loss
    target_profit_cents: float = 1.0
    stop_loss_cents: float = 3.0
    daily_loss_limit_usdc: float = 200.0

    # Timing
    scan_interval_seconds: float = 30.0
    requote_delay_seconds: float = 1.0
    order_ttl_seconds: int = 60
    api_timeout_seconds: float = 10.0

    # Value betting (triangulation)
    enable_value_betting: bool = True
    market_scan_interval_sec: float = 1.5  # fast scanning every 1.5s
    min_mispricing_cents: float = 1.0  # trade if mispricing >= 1 cent
    max_concurrent_positions: int = 5  # max # of concurrent long/short positions
    max_position_hold_duration: float = 300.0  # force-close after 5 minutes
    max_position_per_token_usdc: float = 100.0  # max size per token

    # Retry backoff
    backoff_base_seconds: float = 1.0
    backoff_max_seconds: float = 60.0
    backoff_factor: float = 2.0


def load_config() -> Config:
    load_dotenv()

    def _require(key: str) -> str:
        val = os.getenv(key, "").strip()
        if not val:
            raise RuntimeError(f"Missing required env var: {key}")
        return val

    def _float(key: str, default: float) -> float:
        return float(os.getenv(key, str(default)))

    def _int(key: str, default: int) -> int:
        return int(os.getenv(key, str(default)))

    return Config(
        clob_api_url=os.getenv("CLOB_API_URL", "https://clob.polymarket.com"),
        clob_api_key=_require("CLOB_API_KEY"),
        clob_secret=_require("CLOB_SECRET"),
        clob_passphrase=_require("CLOB_PASS_PHRASE"),
        private_key=_require("PK"),
        max_concurrent_markets=_int("MAX_CONCURRENT_MARKETS", 10),
        min_spread_cents=_float("MIN_SPREAD_CENTS", 2.0),
        min_volume_usd=_float("MIN_VOLUME_USD", 50_000.0),
        min_price_cents=_float("MIN_PRICE_CENTS", 5.0),
        max_price_cents=_float("MAX_PRICE_CENTS", 95.0),
        order_size_usdc=_float("ORDER_SIZE_USDC", 25.0),
        target_profit_cents=_float("TARGET_PROFIT_CENTS", 1.0),
        stop_loss_cents=_float("STOP_LOSS_CENTS", 3.0),
        daily_loss_limit_usdc=_float("DAILY_LOSS_LIMIT_USDC", 200.0),
        scan_interval_seconds=_float("SCAN_INTERVAL_SECONDS", 30.0),
        requote_delay_seconds=_float("REQUOTE_DELAY_SECONDS", 1.0),
        order_ttl_seconds=_int("ORDER_TTL_SECONDS", 60),
        enable_value_betting=os.getenv("ENABLE_VALUE_BETTING", "true").lower() == "true",
        market_scan_interval_sec=_float("MARKET_SCAN_INTERVAL_SEC", 1.5),
        min_mispricing_cents=_float("MIN_MISPRICING_CENTS", 1.0),
        max_concurrent_positions=_int("MAX_CONCURRENT_POSITIONS", 5),
        max_position_hold_duration=_float("MAX_POSITION_HOLD_DURATION", 300.0),
        max_position_per_token_usdc=_float("MAX_POSITION_PER_TOKEN_USDC", 100.0),
    )
