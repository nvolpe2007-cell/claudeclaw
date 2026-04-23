"""Polymarket 24/7 scalping bot entry point."""
from __future__ import annotations

import asyncio
import logging
import signal
import sys

from bot.client import PolyClient
from bot.config import load_config
from bot.risk import RiskManager
from bot.scalper import MarketScalper
from bot.scanner import MarketScanner

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
    # Quiet noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("web3").setLevel(logging.WARNING)


class BotCoordinator:
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
        self._active_scalpers: dict[str, MarketScalper] = {}
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._shutdown = asyncio.Event()

    async def run(self) -> None:
        logger.info("=== Polymarket Scalping Bot started ===")
        bal = await self._client.get_balance_allowance()
        logger.info("Wallet balance: %s", bal)

        while not self._shutdown.is_set():
            if self._risk.is_daily_limit_breached():
                logger.critical("Daily loss limit hit — shutting down")
                break

            try:
                await self._scan_and_rebalance()
            except Exception as exc:
                logger.error("Coordinator scan error: %s", exc, exc_info=True)

            try:
                await asyncio.wait_for(
                    asyncio.shield(self._shutdown.wait()),
                    timeout=self._config.scan_interval_seconds,
                )
            except asyncio.TimeoutError:
                pass

        await self._shutdown_all()

    async def _scan_and_rebalance(self) -> None:
        opportunities = await self._scanner.scan()
        top = opportunities[: self._config.max_concurrent_markets]
        desired = {opp.token_id_yes for opp in top}
        current = set(self._active_scalpers.keys())

        for token_id in current - desired:
            logger.info("Dropping market %s (no longer in top %d)", token_id[:12], self._config.max_concurrent_markets)
            await self._stop_scalper(token_id)

        opp_map = {opp.token_id_yes: opp for opp in top}
        for token_id in desired - current:
            opp = opp_map[token_id]
            if not self._risk.can_enter(token_id, self._config.order_size_usdc):
                continue
            self._start_scalper(opp)

        logger.info(
            "Active scalpers: %d | daily P&L: %+.4f USDC",
            len(self._active_scalpers),
            self._risk.get_daily_pnl(),
        )

    def _start_scalper(self, opp) -> None:
        scalper = MarketScalper(opp, self._client, self._config, self._risk)
        task = asyncio.create_task(scalper.run(), name=f"scalper-{opp.token_id_yes[:12]}")
        task.add_done_callback(lambda t: self._on_task_done(opp.token_id_yes, t))
        self._active_scalpers[opp.token_id_yes] = scalper
        self._active_tasks[opp.token_id_yes] = task
        logger.info("Started scalper: %s", opp.question[:60])

    def _on_task_done(self, token_id: str, task: asyncio.Task) -> None:
        self._active_scalpers.pop(token_id, None)
        self._active_tasks.pop(token_id, None)
        if task.exception():
            logger.error("Scalper task failed: %s", task.exception())

    async def _stop_scalper(self, token_id: str) -> None:
        scalper = self._active_scalpers.pop(token_id, None)
        if scalper:
            scalper.stop()
        task = self._active_tasks.pop(token_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=10.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

    async def _shutdown_all(self) -> None:
        logger.info("Shutting down %d scalpers...", len(self._active_scalpers))
        for token_id in list(self._active_scalpers.keys()):
            await self._stop_scalper(token_id)
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

    client = PolyClient(config)
    loop = asyncio.get_running_loop()
    client.initialise(loop)

    risk = RiskManager(config)
    risk.load_state(STATE_PATH)

    scanner = MarketScanner(client, config)
    coordinator = BotCoordinator(config, client, scanner, risk)

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, coordinator.request_shutdown)

    await coordinator.run()


if __name__ == "__main__":
    asyncio.run(async_main())
