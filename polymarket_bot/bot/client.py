from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import TYPE_CHECKING, Any

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import (
    ApiCreds,
    BookParams,
    OpenOrderParams,
    OrderArgs,
    OrderType,
    TradeParams,
)
from py_clob_client.constants import POLYGON

if TYPE_CHECKING:
    from bot.config import Config

logger = logging.getLogger(__name__)

_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class PolyApiError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class PolyClient:
    """Async-safe wrapper around the synchronous py-clob-client ClobClient.

    All API calls are dispatched to a single-worker ThreadPoolExecutor so the
    asyncio event loop is never blocked, and concurrent calls are serialised to
    respect rate limits.
    """

    def __init__(self, config: Config) -> None:
        self._config = config
        self._executor: ThreadPoolExecutor | None = None
        self._clob: ClobClient | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def initialise(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clob")
        creds = ApiCreds(
            api_key=self._config.clob_api_key,
            api_secret=self._config.clob_secret,
            api_passphrase=self._config.clob_passphrase,
        )
        self._clob = ClobClient(
            host=self._config.clob_api_url,
            key=self._config.private_key,
            chain_id=POLYGON,
            creds=creds,
            signature_type=0,
        )
        logger.info("ClobClient initialised for %s", self._config.clob_api_url)

    async def _run(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        assert self._loop and self._executor and self._clob, "call initialise() first"
        delay = self._config.backoff_base_seconds
        last_exc: Exception | None = None
        for attempt in range(8):
            try:
                return await self._loop.run_in_executor(
                    self._executor, partial(fn, *args, **kwargs)
                )
            except Exception as exc:
                status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
                if status in _RETRYABLE_STATUSES:
                    logger.warning("API error %s (attempt %d) — retrying in %.1fs", status, attempt + 1, delay)
                    await asyncio.sleep(delay)
                    delay = min(delay * self._config.backoff_factor, self._config.backoff_max_seconds)
                    last_exc = exc
                else:
                    raise PolyApiError(str(exc), status) from exc
        raise PolyApiError("API call failed after 8 retries") from last_exc

    # -------------------------------------------------------------------------
    # Market data
    # -------------------------------------------------------------------------

    async def get_markets(self, next_cursor: str = "") -> dict:
        return await self._run(self._clob.get_markets, next_cursor=next_cursor)

    async def get_order_book(self, token_id: str) -> Any:
        return await self._run(self._clob.get_order_book, token_id)

    # -------------------------------------------------------------------------
    # Order management
    # -------------------------------------------------------------------------

    async def create_and_post_order(
        self,
        token_id: str,
        price: float,
        size: float,
        side: str,
        order_type: OrderType = OrderType.GTC,
    ) -> dict:
        args = OrderArgs(token_id=token_id, price=price, size=size, side=side)
        signed = await self._run(self._clob.create_order, args)
        return await self._run(self._clob.post_order, signed, order_type)

    async def cancel_order(self, order_id: str) -> dict:
        return await self._run(self._clob.cancel, order_id)

    async def cancel_orders(self, order_ids: list[str]) -> dict:
        return await self._run(self._clob.cancel_orders, order_ids)

    async def cancel_market_orders(self, asset_id: str) -> dict:
        return await self._run(self._clob.cancel_market_orders, asset_id=asset_id)

    async def get_open_orders(self, asset_id: str | None = None) -> list[dict]:
        params = OpenOrderParams(asset_id=asset_id) if asset_id else OpenOrderParams()
        result = await self._run(self._clob.get_orders, params)
        return result if isinstance(result, list) else []

    async def get_trades(self, asset_id: str | None = None, after: str | None = None) -> list[dict]:
        params = TradeParams(
            maker_address=self._clob.get_address(),
            asset_id=asset_id,
            after=after,
        )
        result = await self._run(self._clob.get_trades, params)
        return result if isinstance(result, list) else []

    async def get_balance_allowance(self) -> dict:
        return await self._run(self._clob.get_balance_allowance)

    def get_address(self) -> str:
        assert self._clob, "call initialise() first"
        return self._clob.get_address()
