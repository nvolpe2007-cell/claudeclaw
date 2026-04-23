"""Polymarket value betting bot with fast market scanning."""
from __future__ import annotations

import asyncio
import logging
import signal
import sys

from bot.client import PolyClient
from bot.config import load_config
from bot.opportunity import OpportunityDetector
from bot.risk import RiskManager
from bot.scanner import MarketScanner
from bot.triangulation import MarketGraph
from bot.valuer import ValueExecutor

STATE_PATH = "state/risk_state.json"
LOG_PATH = "bot.log"

logger = logging.getLogger(__name__)


def setup_logging() -> None:
    fmt = "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(LOG_PATH),
        ],
    )
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("web3").setLevel(logging.WARNING)


class ValueBettingCoordinator:
    """Coordinator for fast market scanning + value betting execution."""

    def __init__(
        self,
        config,
        client: PolyClient,
        scanner: MarketScanner,
        risk: RiskManager,
    ) -> None:
        self._config = config
        self._client = client
        self._scanner = scanner
        self._risk = risk

        # Triangulation + opportunity detection
        self._graph = MarketGraph()
        self._detector = OpportunityDetector(self._graph, config)

        # Value executor
        self._executor = ValueExecutor(client, config, risk)

        self._shutdown = asyncio.Event()
        self._last_rebalance = 0.0

    async def run(self) -> None:
        logger.info("=== Polymarket Value Betting Bot started ===")
        try:
            bal = await self._client.get_balance_allowance()
            logger.info("Wallet balance/allowance: %s", bal)
        except Exception as exc:
            logger.warning("Failed to fetch balance: %s", exc)

        while not self._shutdown.is_set():
            if self._risk.is_daily_limit_breached():
                logger.critical("Daily loss limit hit — shutting down")
                break

            try:
                # FAST: Scan markets and detect opportunities every 1-2 seconds
                await self._fast_scan_loop()
            except Exception as exc:
                logger.error("Scan loop error: %s", exc, exc_info=True)

            await asyncio.sleep(self._config.market_scan_interval_sec)

        await self._shutdown_all()

    async def _fast_scan_loop(self) -> None:
        """Fast market scanning and opportunity detection."""
        # Scan all BTC markets
        all_markets = await self._scanner.scan()

        # Add markets to triangulation graph
        for opp in all_markets:
            self._graph.add_market(opp)

        # Detect mispricings
        opportunities = await self._detector.find_opportunities()

        if not opportunities:
            return

        # Process top opportunities (normal execution speed)
        for opp in opportunities:
            if self._risk.is_daily_limit_breached():
                break
            try:
                await self._executor.process_opportunity(opp)
            except Exception as exc:
                logger.error("Execution error for %s: %s", opp.token_id[:12], exc)

        # Periodic rebalancing (every 30s)
        import time
        now = time.time()
        if now - self._last_rebalance >= 30:
            await self._executor.rebalance_positions()
            self._last_rebalance = now

        # Log status
        logger.info(
            "Scan: %d markets, %d opps | Positions: %d | Daily P&L: %+.2f USDC",
            len(all_markets),
            len(opportunities),
            len(self._executor.positions),
            self._risk.get_daily_pnl(),
        )

    async def _shutdown_all(self) -> None:
        logger.info("Shutting down...")
        try:
            # Close all open positions
            import time
            for token_id in list(self._executor.positions.keys()):
                try:
                    book = await self._client.get_order_book(token_id)
                    bids = getattr(book, "bids", []) or []
                    asks = getattr(book, "asks", []) or []
                    if bids and asks:
                        mid = (float(bids[0].get("price", 0)) + float(asks[0].get("price", 1))) / 2
                        exit_price = round(mid, 2)

                        pos = self._executor.positions[token_id]
                        side = "SELL" if pos.side == "LONG" else "BUY"
                        await self._client.create_and_post_order(token_id, exit_price, pos.size, side)

                        pnl_usdc = (exit_price - pos.entry_price) * pos.size * (
                            1 if pos.side == "LONG" else -1
                        )
                        self._risk.record_fill(token_id, pnl_usdc)
                        del self._executor.positions[token_id]
                except Exception as exc:
                    logger.warning("Error closing position: %s", exc)
        except Exception as exc:
            logger.warning("Error during shutdown: %s", exc)

        self._risk.save_state(STATE_PATH)
        logger.info("=== Bot shutdown complete ===")

    def request_shutdown(self) -> None:
        logger.info("Shutdown requested")
        self._shutdown.set()


async def async_main() -> None:
    setup_logging()

    try:
        config = load_config()
    except RuntimeError as exc:
        logger.critical("Config error: %s", exc)
        logger.critical("Copy .env.example to .env and fill in your credentials.")
        sys.exit(1)

    if not config.enable_value_betting:
        logger.warning("Value betting disabled in config — exiting")
        sys.exit(0)

    client = PolyClient(config)
    loop = asyncio.get_running_loop()
    client.initialise(loop)

    risk = RiskManager(config)
    risk.load_state(STATE_PATH)

    scanner = MarketScanner(client, config)
    coordinator = ValueBettingCoordinator(config, client, scanner, risk)

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, coordinator.request_shutdown)

    await coordinator.run()


if __name__ == "__main__":
    asyncio.run(async_main())
