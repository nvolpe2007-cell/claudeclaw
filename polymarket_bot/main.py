"""Polymarket value betting bot with fast market scanning."""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
import time

from bot.client import PolyClient
from bot.config import load_config
from bot.dashboard import Dashboard
from bot.notifications import Notifier
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
        notifier: Notifier,
        dashboard: Dashboard,
    ) -> None:
        self._config = config
        self._client = client
        self._scanner = scanner
        self._risk = risk
        self._notifier = notifier
        self._dashboard = dashboard

        self._graph = MarketGraph()
        self._detector = OpportunityDetector(self._graph, config)
        self._executor = ValueExecutor(client, config, risk, notifier)

        self._shutdown = asyncio.Event()
        self._last_rebalance = 0.0
        self._last_summary = 0.0

    async def run(self) -> None:
        mode = " [DRY RUN]" if self._config.dry_run else ""
        logger.info("=== Polymarket Value Betting Bot started%s ===", mode)

        try:
            bal = await self._client.get_balance_allowance()
            logger.info("Wallet balance/allowance: %s", bal)
        except Exception as exc:
            logger.warning("Failed to fetch balance: %s", exc)

        while not self._shutdown.is_set():
            if self._risk.is_daily_limit_breached():
                logger.critical("Daily loss limit hit — shutting down")
                await self._notifier.alert("Daily loss limit breached — bot halted")
                break

            try:
                await self._fast_scan_loop()
            except Exception as exc:
                logger.error("Scan loop error: %s", exc, exc_info=True)

            await asyncio.sleep(self._config.market_scan_interval_sec)

        await self._shutdown_all()

    async def _fast_scan_loop(self) -> None:
        all_markets = await self._scanner.scan()

        for opp in all_markets:
            self._graph.add_market(opp)

        opportunities = await self._detector.find_opportunities()

        for opp in opportunities:
            if self._risk.is_daily_limit_breached():
                break
            try:
                await self._executor.process_opportunity(opp)
            except Exception as exc:
                logger.error("Execution error for %s: %s", opp.token_id[:12], exc)

        now = time.time()

        # Periodic rebalancing every 30s
        if now - self._last_rebalance >= 30:
            await self._executor.rebalance_positions()
            self._last_rebalance = now

        # Update dashboard
        self._dashboard.update(
            self._risk,
            self._executor,
            markets_scanned=len(all_markets),
            opportunities_found=len(opportunities),
        )

        # Daily summary notification every hour
        if now - self._last_summary >= 3600:
            await self._notifier.daily_summary(
                self._risk.get_daily_pnl(),
                self._executor.trade_count,
                len(self._executor.positions),
            )
            self._last_summary = now

        logger.info(
            "Scan: %d BTC markets, %d opps | Positions: %d | Daily P&L: %+.2f USDC%s",
            len(all_markets),
            len(opportunities),
            len(self._executor.positions),
            self._risk.get_daily_pnl(),
            " [DRY RUN]" if self._config.dry_run else "",
        )

    async def _shutdown_all(self) -> None:
        logger.info("Shutting down...")

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
                    if not self._config.dry_run:
                        await self._client.create_and_post_order(token_id, exit_price, pos.size, side)
                    pnl_usdc = (exit_price - pos.entry_price) * pos.size * (1 if pos.side == "LONG" else -1)
                    self._risk.record_fill(token_id, pnl_usdc)
                    del self._executor.positions[token_id]
            except Exception as exc:
                logger.warning("Error closing position on shutdown: %s", exc)

        self._risk.save_state(STATE_PATH)
        self._dashboard.stop()
        logger.info("=== Bot shutdown complete | Final P&L: %+.4f USDC ===", self._risk.get_daily_pnl())

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

    if config.dry_run:
        logger.info("*** DRY RUN MODE — no real orders will be placed ***")

    if not config.enable_value_betting:
        logger.warning("Value betting disabled in config — exiting")
        sys.exit(0)

    client = PolyClient(config)
    loop = asyncio.get_running_loop()
    client.initialise(loop)

    risk = RiskManager(config)
    risk.load_state(STATE_PATH)

    notifier = Notifier(config)
    dashboard = Dashboard(port=config.dashboard_port, dry_run=config.dry_run)

    if config.dashboard_enabled:
        dashboard.start()

    scanner = MarketScanner(client, config)
    coordinator = ValueBettingCoordinator(config, client, scanner, risk, notifier, dashboard)

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, coordinator.request_shutdown)

    await coordinator.run()


if __name__ == "__main__":
    asyncio.run(async_main())
