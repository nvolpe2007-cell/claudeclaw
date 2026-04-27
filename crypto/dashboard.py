"""
Trading dashboard — serves a live web UI at http://localhost:8080

Reads trades_paper.csv and trade_lessons.json from the repo root.
No extra dependencies beyond the standard library + what's in requirements.txt.

Run:
    python crypto/dashboard.py
    python crypto/dashboard.py --port 8080
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

_SCRIPT_DIR  = Path(__file__).resolve().parent
TRADE_LOG    = _SCRIPT_DIR.parent / "trades_paper.csv"
LESSONS_FILE = _SCRIPT_DIR.parent / "trade_lessons.json"


# ── DATA LOADING ──────────────────────────────────────────────────────────────

def load_trades() -> list[dict]:
    if not TRADE_LOG.exists():
        return []
    with open(TRADE_LOG, newline="") as f:
        return list(csv.DictReader(f))


def load_lessons() -> list[dict]:
    if not LESSONS_FILE.exists():
        return []
    try:
        with open(LESSONS_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def compute_stats(trades: list[dict]) -> dict:
    if not trades:
        return {
            "total": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "total_pnl": 0.0, "avg_win": 0.0, "avg_loss": 0.0,
            "best": 0.0, "worst": 0.0, "by_symbol": {},
        }

    wins, losses = [], []
    by_symbol: dict[str, dict] = {}

    for t in trades:
        try:
            pnl = float(t["pnl_pct"])
        except (KeyError, ValueError):
            continue
        sym = t.get("symbol", "?")
        if sym not in by_symbol:
            by_symbol[sym] = {"trades": 0, "pnl": 0.0, "wins": 0}
        by_symbol[sym]["trades"] += 1
        by_symbol[sym]["pnl"]    += pnl
        if pnl >= 0:
            wins.append(pnl)
            by_symbol[sym]["wins"] += 1
        else:
            losses.append(pnl)

    total_pnl = sum(wins) + sum(losses)
    return {
        "total":    len(wins) + len(losses),
        "wins":     len(wins),
        "losses":   len(losses),
        "win_rate": len(wins) / (len(wins) + len(losses)) * 100 if (wins or losses) else 0.0,
        "total_pnl": total_pnl * 100,
        "avg_win":  (sum(wins)   / len(wins)   * 100) if wins   else 0.0,
        "avg_loss": (sum(losses) / len(losses) * 100) if losses else 0.0,
        "best":     max(wins,   default=0.0) * 100,
        "worst":    min(losses, default=0.0) * 100,
        "by_symbol": {
            sym: {
                "trades":   v["trades"],
                "wins":     v["wins"],
                "pnl":      round(v["pnl"] * 100, 3),
                "win_rate": round(v["wins"] / v["trades"] * 100, 1) if v["trades"] else 0.0,
            }
            for sym, v in sorted(by_symbol.items(),
                                 key=lambda x: -abs(x[1]["pnl"]))
        },
    }


def equity_curve(trades: list[dict]) -> list[float]:
    """Cumulative % PnL over time for charting."""
    curve, running = [0.0], 0.0
    for t in trades:
        try:
            running += float(t["pnl_pct"]) * 100
        except (KeyError, ValueError):
            continue
        curve.append(round(running, 4))
    return curve


# ── API HANDLER ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress request log noise

    def _send(self, code: int, content_type: str, body: bytes | str):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/data":
            trades  = load_trades()
            lessons = load_lessons()
            stats   = compute_stats(trades)
            payload = {
                "stats":   stats,
                "trades":  trades[-50:][::-1],  # last 50, newest first
                "lessons": lessons[-10:][::-1],
                "curve":   equity_curve(trades),
            }
            self._send(200, "application/json", json.dumps(payload))
        elif path == "/" or path == "/index.html":
            self._send(200, "text/html; charset=utf-8", _HTML)
        else:
            self._send(404, "text/plain", "not found")


# ── HTML DASHBOARD ────────────────────────────────────────────────────────────

_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trading Dashboard</title>
<style>
  :root {
    --bg:      #0d0f14;
    --surface: #151820;
    --border:  #1e2330;
    --muted:   #4a5168;
    --text:    #c8cdd8;
    --bright:  #e8ecf4;
    --green:   #36d68a;
    --red:     #f05252;
    --yellow:  #f5a623;
    --blue:    #4f8ef7;
    --purple:  #a78bfa;
    --radius:  8px;
    --font:    'JetBrains Mono', 'Fira Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.6;
    padding: 24px;
    min-height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  header h1 {
    font-size: 18px;
    color: var(--bright);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  header h1 span { color: var(--green); }
  #refresh-info { color: var(--muted); font-size: 11px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .card-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
  .card-value { font-size: 24px; font-weight: 700; color: var(--bright); }
  .card-value.pos { color: var(--green); }
  .card-value.neg { color: var(--red); }
  .card-value.neutral { color: var(--yellow); }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }
  @media (max-width: 700px) { .row { grid-template-columns: 1fr; } }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .panel-header {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .panel-body { padding: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    padding: 6px 8px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .pos { color: var(--green); }
  .neg { color: var(--red); }
  .badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-long  { background: rgba(54,214,138,0.15); color: var(--green); }
  .badge-short { background: rgba(240,82,82,0.15);  color: var(--red);   }
  .badge-sl    { background: rgba(240,82,82,0.15);  color: var(--red);   }
  .badge-tp    { background: rgba(54,214,138,0.15); color: var(--green); }
  .badge-meme  { background: rgba(167,139,250,0.15); color: var(--purple); }
  svg.chart { display: block; width: 100%; }
  .empty { color: var(--muted); text-align: center; padding: 32px 0; font-size: 12px; }
  .sym-row td:first-child { color: var(--blue); font-weight: 600; }
  .win-bar-wrap { background: var(--border); border-radius: 3px; height: 4px; margin-top: 4px; }
  .win-bar { background: var(--green); height: 4px; border-radius: 3px; transition: width 0.4s; }
  #no-data {
    display: none;
    text-align: center;
    padding: 80px 20px;
    color: var(--muted);
  }
  #no-data h2 { font-size: 16px; margin-bottom: 8px; color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>ClaudeClaw <span>Trading</span></h1>
  <div id="refresh-info">loading…</div>
</header>

<div id="no-data">
  <h2>No trades yet</h2>
  <p>Start the bot in paper mode: <code>PAPER_TRADING=true python crypto/bot.py</code></p>
</div>

<div id="main">
  <div class="cards" id="stat-cards">
    <div class="card"><div class="card-label">Total Trades</div><div class="card-value" id="s-total">–</div></div>
    <div class="card"><div class="card-label">Win Rate</div><div class="card-value" id="s-wr">–</div></div>
    <div class="card"><div class="card-label">Total P&amp;L</div><div class="card-value" id="s-pnl">–</div></div>
    <div class="card"><div class="card-label">Avg Win</div><div class="card-value pos" id="s-avgw">–</div></div>
    <div class="card"><div class="card-label">Avg Loss</div><div class="card-value neg" id="s-avgl">–</div></div>
    <div class="card"><div class="card-label">Best Trade</div><div class="card-value pos" id="s-best">–</div></div>
  </div>

  <!-- Equity curve full width -->
  <div class="panel" style="margin-bottom:24px">
    <div class="panel-header">Equity Curve</div>
    <div class="panel-body" style="padding:8px 16px 16px">
      <svg class="chart" id="equity-svg" height="120"></svg>
    </div>
  </div>

  <div class="row">
    <!-- Per-symbol breakdown -->
    <div class="panel">
      <div class="panel-header">By Symbol</div>
      <div class="panel-body" style="padding:8px 0 0">
        <table id="sym-table">
          <thead><tr><th>Symbol</th><th>Trades</th><th>Win %</th><th>P&amp;L %</th></tr></thead>
          <tbody id="sym-body"></tbody>
        </table>
      </div>
    </div>

    <!-- Recent losing trades / lessons -->
    <div class="panel">
      <div class="panel-header">Recent Losses (post-mortems)</div>
      <div class="panel-body" style="padding:8px 0 0">
        <table id="lesson-table">
          <thead><tr><th>Symbol</th><th>Dir</th><th>P&amp;L %</th><th>Trigger</th><th>Str</th></tr></thead>
          <tbody id="lesson-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Recent trades -->
  <div class="panel">
    <div class="panel-header">Recent Trades (last 50)</div>
    <div class="panel-body" style="padding:8px 0 0; overflow-x:auto">
      <table id="trades-table">
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Symbol</th>
            <th>Dir</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P&amp;L %</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody id="trades-body"></tbody>
      </table>
      <div class="empty" id="trades-empty" style="display:none">No closed trades yet</div>
    </div>
  </div>
</div>

<script>
const MEME = new Set(['DOGE/USD','SHIB/USD','PEPE/USD','FLOKI/USD']);
const fmt  = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtP = n => n.toFixed(4);

function setCard(id, val, cls) {
  const el = document.getElementById(id);
  el.textContent = val;
  if (cls) el.className = 'card-value ' + cls;
}

function drawEquity(curve) {
  const svg = document.getElementById('equity-svg');
  const W = svg.parentElement.clientWidth || 600;
  const H = 120, PAD = 8;

  if (curve.length < 2) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#4a5168" font-size="12">Not enough data</text>';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    return;
  }

  const min = Math.min(...curve), max = Math.max(...curve);
  const range = max - min || 1;
  const xs = curve.map((_, i) => PAD + (i / (curve.length - 1)) * (W - PAD*2));
  const ys = curve.map(v => PAD + ((max - v) / range) * (H - PAD*2));
  const zero_y = PAD + ((max - 0) / range) * (H - PAD*2);

  let path = `M${xs[0]},${ys[0]}`;
  for (let i = 1; i < xs.length; i++) path += ` L${xs[i]},${ys[i]}`;

  const final = curve[curve.length - 1];
  const color = final >= 0 ? '#36d68a' : '#f05252';

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <line x1="${PAD}" y1="${Math.max(PAD, Math.min(H-PAD, zero_y))}"
          x2="${W-PAD}" y2="${Math.max(PAD, Math.min(H-PAD, zero_y))}"
          stroke="#1e2330" stroke-width="1"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/>
    <text x="${W-PAD-2}" y="${Math.max(14, Math.min(H-4, ys[ys.length-1]-4))}"
          text-anchor="end" fill="${color}" font-size="11" font-family="monospace">
      ${fmt(final)}
    </text>`;
}

function renderSymbols(by_symbol) {
  const tbody = document.getElementById('sym-body');
  tbody.innerHTML = '';
  const entries = Object.entries(by_symbol);
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">—</td></tr>';
    return;
  }
  for (const [sym, d] of entries) {
    const isMeme = MEME.has(sym);
    const pnlCls = d.pnl >= 0 ? 'pos' : 'neg';
    tbody.innerHTML += `<tr class="sym-row">
      <td>${sym}${isMeme ? ' <span class="badge badge-meme">meme</span>' : ''}</td>
      <td>${d.trades}</td>
      <td>
        ${d.win_rate.toFixed(0)}%
        <div class="win-bar-wrap"><div class="win-bar" style="width:${d.win_rate}%"></div></div>
      </td>
      <td class="${pnlCls}">${fmt(d.pnl)}</td>
    </tr>`;
  }
}

function renderLessons(lessons) {
  const tbody = document.getElementById('lesson-body');
  tbody.innerHTML = '';
  if (!lessons.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No losses yet</td></tr>';
    return;
  }
  for (const l of lessons) {
    const sig     = l.signal || {};
    const trigger = sig.trigger || '—';
    const str     = sig.strength ?? '—';
    tbody.innerHTML += `<tr>
      <td>${l.symbol}</td>
      <td><span class="badge badge-${l.direction.toLowerCase()}">${l.direction}</span></td>
      <td class="neg">${fmt(l.pnl_pct)}</td>
      <td>${trigger}</td>
      <td>${str}</td>
    </tr>`;
  }
}

function renderTrades(trades) {
  const tbody = document.getElementById('trades-body');
  const empty = document.getElementById('trades-empty');
  tbody.innerHTML = '';
  if (!trades.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  for (const t of trades) {
    const pnl    = parseFloat(t.pnl_pct) * 100;
    const pnlCls = pnl >= 0 ? 'pos' : 'neg';
    const dir    = (t.direction || '').toLowerCase();
    const reason = (t.exit_reason || '').startsWith('TP') ? 'tp' : 'sl';
    const time   = (t.time_utc || '').replace('T', ' ').slice(0, 19);
    tbody.innerHTML += `<tr>
      <td>${time}</td>
      <td>${t.symbol}</td>
      <td><span class="badge badge-${dir}">${t.direction}</span></td>
      <td>${fmtP(parseFloat(t.entry))}</td>
      <td>${fmtP(parseFloat(t.exit))}</td>
      <td class="${pnlCls}">${fmt(pnl)}</td>
      <td><span class="badge badge-${reason}">${t.exit_reason}</span></td>
    </tr>`;
  }
}

async function refresh() {
  try {
    const r    = await fetch('/api/data');
    const data = await r.json();
    const s    = data.stats;

    document.getElementById('no-data').style.display = s.total === 0 ? '' : 'none';
    document.getElementById('main').style.display    = s.total === 0 ? 'none' : '';

    setCard('s-total', s.total, '');
    setCard('s-wr',   s.win_rate.toFixed(1) + '%', s.win_rate >= 50 ? 'pos' : 'neg');
    setCard('s-pnl',  fmt(s.total_pnl), s.total_pnl >= 0 ? 'pos' : 'neg');
    setCard('s-avgw', fmt(s.avg_win),  'pos');
    setCard('s-avgl', fmt(s.avg_loss), 'neg');
    setCard('s-best', fmt(s.best),     'pos');

    drawEquity(data.curve);
    renderSymbols(s.by_symbol);
    renderLessons(data.lessons);
    renderTrades(data.trades);

    const now = new Date().toLocaleTimeString();
    document.getElementById('refresh-info').textContent = `updated ${now} · auto-refresh 30s`;
  } catch (e) {
    document.getElementById('refresh-info').textContent = 'error loading data';
  }
}

refresh();
setInterval(refresh, 30_000);
window.addEventListener('resize', () => {
  fetch('/api/data').then(r => r.json()).then(d => drawEquity(d.curve));
});
</script>
</body>
</html>"""


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ClaudeClaw trading dashboard")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="localhost")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), Handler)
    print(f"Dashboard → http://{args.host}:{args.port}")
    print(f"  Trades:  {TRADE_LOG}")
    print(f"  Lessons: {LESSONS_FILE}")
    print("  Ctrl-C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
