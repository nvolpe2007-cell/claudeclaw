from __future__ import annotations

import asyncio
import json
import logging
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.risk import RiskManager
    from bot.valuer import ValueExecutor

logger = logging.getLogger(__name__)


class _State:
    def __init__(self) -> None:
        self.daily_pnl: float = 0.0
        self.trade_count: int = 0
        self.positions: list[dict] = []
        self.last_scan: float = 0.0
        self.dry_run: bool = False
        self.markets_scanned: int = 0
        self.opportunities_found: int = 0


_state = _State()


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass  # suppress access logs

    def do_GET(self) -> None:
        if self.path == "/api/state":
            self._send_json()
        else:
            self._send_html()

    def _send_json(self) -> None:
        data = {
            "daily_pnl": _state.daily_pnl,
            "trade_count": _state.trade_count,
            "positions": _state.positions,
            "last_scan": _state.last_scan,
            "dry_run": _state.dry_run,
            "markets_scanned": _state.markets_scanned,
            "opportunities_found": _state.opportunities_found,
        }
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self) -> None:
        html = _render_html()
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _render_html() -> str:
    pnl = _state.daily_pnl
    pnl_color = "#22c55e" if pnl >= 0 else "#ef4444"
    pnl_sign = "+" if pnl >= 0 else ""
    dry_badge = '<span style="background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px">DRY RUN</span>' if _state.dry_run else ""
    last_scan = time.strftime("%H:%M:%S", time.localtime(_state.last_scan)) if _state.last_scan else "—"

    rows = ""
    for pos in _state.positions:
        side_color = "#22c55e" if pos["side"] == "LONG" else "#ef4444"
        upnl = pos.get("unrealized_pnl", 0.0)
        upnl_str = f"{'+' if upnl >= 0 else ''}{upnl:.4f}"
        upnl_color = "#22c55e" if upnl >= 0 else "#ef4444"
        rows += f"""
        <tr>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{pos['question'][:70]}</td>
          <td style="color:{side_color}">{pos['side']}</td>
          <td>{pos['entry_cents']:.1f}¢</td>
          <td>{pos['fair_cents']:.1f}¢</td>
          <td style="color:{upnl_color}">${upnl_str}</td>
          <td>{pos['hold_sec']:.0f}s</td>
        </tr>"""

    positions_table = f"""
    <table>
      <thead><tr>
        <th>Market</th><th>Side</th><th>Entry</th><th>Fair</th><th>Unreal. P&L</th><th>Hold</th>
      </tr></thead>
      <tbody>{rows if rows else '<tr><td colspan="6" style="text-align:center;color:#888">No open positions</td></tr>'}</tbody>
    </table>""" if True else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Polymarket Bot Dashboard</title>
<meta http-equiv="refresh" content="3">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: monospace; background: #0f172a; color: #e2e8f0; padding: 24px; }}
  h1 {{ font-size: 20px; margin-bottom: 4px; }}
  .subtitle {{ color: #94a3b8; font-size: 13px; margin-bottom: 24px; }}
  .cards {{ display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }}
  .card {{ background: #1e293b; border-radius: 8px; padding: 16px 24px; min-width: 160px; }}
  .card-label {{ color: #94a3b8; font-size: 12px; margin-bottom: 4px; }}
  .card-value {{ font-size: 28px; font-weight: bold; }}
  table {{ width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }}
  th {{ background: #0f172a; color: #94a3b8; font-size: 12px; padding: 10px 14px; text-align: left; }}
  td {{ padding: 10px 14px; border-top: 1px solid #0f172a; font-size: 13px; }}
  tr:hover td {{ background: #263148; }}
  .footer {{ margin-top: 16px; color: #475569; font-size: 12px; }}
</style>
</head>
<body>
<h1>Polymarket Bot {dry_badge}</h1>
<div class="subtitle">Last scan: {last_scan} &nbsp;|&nbsp; Markets scanned: {_state.markets_scanned} &nbsp;|&nbsp; Opportunities: {_state.opportunities_found}</div>
<div class="cards">
  <div class="card">
    <div class="card-label">Daily P&L</div>
    <div class="card-value" style="color:{pnl_color}">{pnl_sign}${pnl:.4f}</div>
  </div>
  <div class="card">
    <div class="card-label">Total Trades</div>
    <div class="card-value">{_state.trade_count}</div>
  </div>
  <div class="card">
    <div class="card-label">Open Positions</div>
    <div class="card-value">{len(_state.positions)}</div>
  </div>
</div>
{positions_table}
<div class="footer">Auto-refreshes every 3s &nbsp;|&nbsp; JSON: <a href="/api/state" style="color:#60a5fa">/api/state</a></div>
</body>
</html>"""


class Dashboard:
    def __init__(self, port: int = 8080, dry_run: bool = False) -> None:
        self._port = port
        _state.dry_run = dry_run
        self._server: HTTPServer | None = None
        self._thread: Thread | None = None

    def update(
        self,
        risk: RiskManager,
        executor: ValueExecutor,
        markets_scanned: int = 0,
        opportunities_found: int = 0,
    ) -> None:
        _state.daily_pnl = risk.get_daily_pnl()
        _state.trade_count = executor.trade_count
        _state.last_scan = time.time()
        _state.markets_scanned = markets_scanned
        _state.opportunities_found = opportunities_found

        now = time.time()
        positions = []
        for token_id, pos in executor.positions.items():
            positions.append({
                "token_id": token_id,
                "question": pos.question,
                "side": pos.side,
                "entry_cents": pos.entry_price * 100,
                "fair_cents": pos.fair_value_at_entry * 100,
                "unrealized_pnl": 0.0,  # would need live price to compute
                "hold_sec": now - pos.opened_at,
            })
        _state.positions = positions

    def start(self) -> None:
        self._server = HTTPServer(("0.0.0.0", self._port), _Handler)
        self._thread = Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info("Dashboard running at http://localhost:%d", self._port)

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
