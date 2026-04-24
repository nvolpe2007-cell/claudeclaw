from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING
from urllib.request import Request, urlopen
from urllib.error import URLError

if TYPE_CHECKING:
    from bot.config import Config

logger = logging.getLogger(__name__)


class Notifier:
    """Send trade notifications via Telegram and/or Discord webhooks."""

    def __init__(self, config: Config) -> None:
        self._tg_token = config.telegram_bot_token
        self._tg_chat = config.telegram_chat_id
        self._discord_url = config.discord_webhook_url
        self._dry_run = config.dry_run

    async def position_opened(
        self,
        side: str,
        question: str,
        price_cents: float,
        fair_cents: float,
        size: float,
    ) -> None:
        mode = "[DRY RUN] " if self._dry_run else ""
        emoji = "🟢" if side == "LONG" else "🔴"
        msg = (
            f"{emoji} {mode}POSITION OPENED\n"
            f"{'📈 BUY YES' if side == 'LONG' else '📉 SELL YES'}\n"
            f"Market: {question[:80]}\n"
            f"Entry: {price_cents:.1f}¢  |  Fair: {fair_cents:.1f}¢  |  Edge: {fair_cents - price_cents if side == 'LONG' else price_cents - fair_cents:.1f}¢\n"
            f"Size: ${size:.2f}"
        )
        await self._send(msg)

    async def position_closed(
        self,
        side: str,
        question: str,
        entry_cents: float,
        exit_cents: float,
        pnl_usdc: float,
    ) -> None:
        mode = "[DRY RUN] " if self._dry_run else ""
        emoji = "💰" if pnl_usdc >= 0 else "🔻"
        sign = "+" if pnl_usdc >= 0 else ""
        msg = (
            f"{emoji} {mode}POSITION CLOSED\n"
            f"Market: {question[:80]}\n"
            f"Entry: {entry_cents:.1f}¢ → Exit: {exit_cents:.1f}¢\n"
            f"P&L: {sign}${pnl_usdc:.4f} USDC"
        )
        await self._send(msg)

    async def daily_summary(self, pnl: float, trades: int, positions: int) -> None:
        sign = "+" if pnl >= 0 else ""
        emoji = "📊"
        msg = (
            f"{emoji} Daily Summary\n"
            f"P&L: {sign}${pnl:.4f} USDC\n"
            f"Trades: {trades}  |  Open Positions: {positions}"
        )
        await self._send(msg)

    async def alert(self, message: str) -> None:
        await self._send(f"⚠️ ALERT: {message}")

    # -------------------------------------------------------------------------

    async def _send(self, text: str) -> None:
        tasks = []
        if self._tg_token and self._tg_chat:
            tasks.append(self._send_telegram(text))
        if self._discord_url:
            tasks.append(self._send_discord(text))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send_telegram(self, text: str) -> None:
        url = f"https://api.telegram.org/bot{self._tg_token}/sendMessage"
        payload = json.dumps({"chat_id": self._tg_chat, "text": text}).encode()
        req = Request(url, data=payload, headers={"Content-Type": "application/json"})
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, lambda: urlopen(req, timeout=5))
        except URLError as exc:
            logger.warning("Telegram send failed: %s", exc)

    async def _send_discord(self, text: str) -> None:
        payload = json.dumps({"content": text}).encode()
        req = Request(
            self._discord_url,
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, lambda: urlopen(req, timeout=5))
        except URLError as exc:
            logger.warning("Discord send failed: %s", exc)
