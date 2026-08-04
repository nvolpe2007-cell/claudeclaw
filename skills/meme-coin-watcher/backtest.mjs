#!/usr/bin/env node
// Backtest the Meme Coin Watcher's alert history.
//
// Reads the append-only alert log (alerts.jsonl, written by watcher.mjs), which
// records an entry-price snapshot for every fired alert, then re-prices each
// token now via DexScreener and reports how those calls actually performed —
// win rate, hit rate at a target multiple, median/mean return — broken down by
// tier. This is the "does the filter actually have an edge" measurement.
//
// Runtime: Node 18+ or Bun (uses global fetch, no dependencies).
//
// Usage:
//   node backtest.mjs [--file <path>] [--since <hours>] [--min-elapsed <hours>]
//                     [--target <pct>] [--tier confirmed|headsup|all]
//                     [--dead-as-zero] [--birdeye] [--horizon <hours>]
//                     [--json] [--limit <n>] [--verbose]
//
// Measures:
//   return-to-now (default) — entry price (logged) vs live price now. Run it a
//     while after the alerts fired so the numbers mean something; --min-elapsed
//     restricts to alerts at least N hours old.
//   peak return (--birdeye, needs BIRDEYE_API_KEY) — the max price within
//     `horizon` hours after each alert (the "could you have sold the top" view),
//     computed from Birdeye OHLCV.
//
// Notes:
//   A token with no live DexScreener pair is treated as unresolved by default;
//   pass --dead-as-zero to count it as -100% (meme pairs often vanish on a rug).

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { pickBestPair, fmtUsd, dexByAddress } from "./watcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HISTORY = join(process.cwd(), ".claude", "claudeclaw", "meme-coin-watcher", "alerts.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

function parseArgs(argv) {
  const a = {
    file: null, since: null, minElapsed: 0, target: 100, tier: "all",
    deadAsZero: false, birdeye: false, horizon: 24, json: false, limit: null, verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--file") a.file = argv[++i];
    else if (x === "--since") a.since = Number(argv[++i]);
    else if (x === "--min-elapsed") a.minElapsed = Number(argv[++i]);
    else if (x === "--target") a.target = Number(argv[++i]);
    else if (x === "--tier") a.tier = argv[++i];
    else if (x === "--dead-as-zero") a.deadAsZero = true;
    else if (x === "--birdeye") a.birdeye = true;
    else if (x === "--horizon") a.horizon = Number(argv[++i]);
    else if (x === "--json") a.json = true;
    else if (x === "--limit") a.limit = Number(argv[++i]);
    else if (x === "--verbose" || x === "-v") a.verbose = true;
  }
  return a;
}

// --- pure helpers (exported for tests) -------------------------------------

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Return-to-now for one record. null when entry price is missing. */
function computeReturn(entryPriceUsd, currentPriceUsd) {
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;
  if (!Number.isFinite(currentPriceUsd)) return null;
  return {
    returnPct: ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100,
    multiple: currentPriceUsd / entryPriceUsd,
  };
}

/** Aggregate stats over rows, reading a numeric field (default returnPct). */
function summarize(rows, targetPct, key = "returnPct") {
  const measured = rows.filter((r) => Number.isFinite(r[key]));
  const rets = measured.map((r) => r[key]);
  const n = measured.length;
  const wins = rets.filter((x) => x > 0).length;
  const hits = rets.filter((x) => x >= targetPct).length;
  return {
    count: rows.length,
    measured: n,
    unresolved: rows.length - n,
    winRate: n ? wins / n : null,
    hitRate: n ? hits / n : null,
    medianReturnPct: median(rets),
    meanReturnPct: n ? rets.reduce((x, y) => x + y, 0) / n : null,
    bestReturnPct: n ? Math.max(...rets) : null,
    worstReturnPct: n ? Math.min(...rets) : null,
  };
}

// --- history loading -------------------------------------------------------

async function loadHistory(path) {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

// --- Birdeye OHLCV peak ----------------------------------------------------

async function birdeyePeak(address, fromTs, toTs) {
  const key = process.env.BIRDEYE_API_KEY || "";
  if (!key) return null;
  const url =
    `https://public-api.birdeye.so/defi/history_price?address=${address}` +
    `&address_type=token&type=15m&time_from=${fromTs}&time_to=${toTs}`;
  try {
    const res = await fetch(url, { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } });
    if (!res.ok) return null;
    const d = await res.json();
    const items = d?.data?.items;
    if (!Array.isArray(items) || !items.length) return null;
    const values = items.map((it) => Number(it.value)).filter(Number.isFinite);
    if (!values.length) return null;
    return { peakPrice: Math.max(...values), closePrice: values[values.length - 1] };
  } catch {
    return null;
  }
}

// --- reporting -------------------------------------------------------------

const pct = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
const rate = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

function renderReport(s, label, targetPct, withPeak) {
  const lines = [];
  lines.push(`── ${label} ──`);
  lines.push(`Alerts: ${s.count}  (measured ${s.measured}, unresolved ${s.unresolved})`);
  lines.push(`Win rate (>0):     ${rate(s.winRate)}`);
  lines.push(`Hit rate (≥${targetPct}%): ${rate(s.hitRate)}`);
  lines.push(`Median return:     ${pct(s.medianReturnPct)}`);
  lines.push(`Mean return:       ${pct(s.meanReturnPct)}`);
  lines.push(`Best / worst:      ${pct(s.bestReturnPct)} / ${pct(s.worstReturnPct)}`);
  if (withPeak && s.peak) {
    lines.push(`Peak win rate:     ${rate(s.peak.winRate)}   hit ≥${targetPct}%: ${rate(s.peak.hitRate)}`);
    lines.push(`Median peak:       ${pct(s.peak.medianReturnPct)}   best peak: ${pct(s.peak.bestReturnPct)}`);
  }
  return lines.join("\n");
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file ? (isAbsolute(args.file) ? args.file : join(process.cwd(), args.file)) : DEFAULT_HISTORY;
  let history = await loadHistory(file);

  if (history.length === 0) {
    const msg = `No alert history at ${file}. Let the watcher run and log some alerts first.`;
    console.log(args.json ? JSON.stringify({ ok: false, error: "no-history", file }, null, 2) : msg);
    return;
  }

  // Filters
  const now = nowSec();
  if (args.since != null) history = history.filter((r) => r.ts >= now - args.since * 3600);
  if (args.minElapsed) history = history.filter((r) => r.ts <= now - args.minElapsed * 3600);
  if (args.tier !== "all") history = history.filter((r) => r.tier === args.tier);
  history.sort((a, b) => a.ts - b.ts);
  if (args.limit) history = history.slice(-args.limit);

  if (history.length === 0) {
    console.log(args.json ? JSON.stringify({ ok: true, rows: [], note: "no records after filters" }, null, 2) : "No records match the filters.");
    return;
  }

  // Re-price each alert
  const rows = [];
  for (const rec of history) {
    let currentPriceUsd = null;
    let livePair = null;
    if (rec.address) {
      livePair = await dexByAddress(rec.address);
      currentPriceUsd = livePair?.priceUsd ?? null;
      await sleep(250); // be gentle on the free DexScreener API
    }

    let returnPct = null;
    let multiple = null;
    if (currentPriceUsd == null && args.deadAsZero && Number.isFinite(rec.entryPriceUsd)) {
      returnPct = -100; // no live pair → treat as total loss
      multiple = 0;
    } else {
      const r = computeReturn(rec.entryPriceUsd, currentPriceUsd);
      if (r) ({ returnPct, multiple } = r);
    }

    let peakReturnPct = null;
    if (args.birdeye && rec.address && Number.isFinite(rec.entryPriceUsd)) {
      const peak = await birdeyePeak(rec.address, rec.ts, rec.ts + args.horizon * 3600);
      if (peak) peakReturnPct = ((peak.peakPrice - rec.entryPriceUsd) / rec.entryPriceUsd) * 100;
      await sleep(250);
    }

    const row = { ...rec, currentPriceUsd, returnPct, multiple, peakReturnPct };
    rows.push(row);
    if (args.verbose) {
      console.error(
        `[backtest] ${rec.symbol || rec.address?.slice(0, 6)} ${rec.tier}: entry ${fmtUsd(rec.entryMarketCap)} ` +
          `ret ${returnPct == null ? "?" : returnPct.toFixed(0) + "%"}`
      );
    }
  }

  // Summaries
  const attachPeak = (s, subset) => (args.birdeye ? { ...s, peak: summarize(subset, args.target, "peakReturnPct") } : s);
  const overall = attachPeak(summarize(rows, args.target), rows);
  const confirmed = rows.filter((r) => r.tier === "confirmed");
  const headsup = rows.filter((r) => r.tier === "headsup");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          file,
          target: args.target,
          overall,
          byTier: {
            confirmed: attachPeak(summarize(confirmed, args.target), confirmed),
            headsup: attachPeak(summarize(headsup, args.target), headsup),
          },
          rows: rows.map((r) => ({
            ts: r.ts, isoTime: r.isoTime, tier: r.tier, symbol: r.symbol, address: r.address,
            score: r.score, entryPriceUsd: r.entryPriceUsd, currentPriceUsd: r.currentPriceUsd,
            returnPct: r.returnPct, multiple: r.multiple, peakReturnPct: r.peakReturnPct,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const parts = [
    `Backtest of ${rows.length} alert(s) from ${file}`,
    `Target multiple: ≥${args.target}% ( ${(1 + args.target / 100).toFixed(1)}x )` +
      (args.birdeye ? `   ·  peak window: ${args.horizon}h` : ""),
    "",
    renderReport(overall, "OVERALL", args.target, args.birdeye),
  ];
  if (confirmed.length) parts.push("", renderReport(attachPeak(summarize(confirmed, args.target), confirmed), "CONFIRMED tier", args.target, args.birdeye));
  if (headsup.length) parts.push("", renderReport(attachPeak(summarize(headsup, args.target), headsup), "HEADS-UP tier", args.target, args.birdeye));

  // Top and bottom calls
  const measured = rows.filter((r) => Number.isFinite(r.returnPct)).sort((a, b) => b.returnPct - a.returnPct);
  if (measured.length) {
    parts.push("", "Best calls:");
    for (const r of measured.slice(0, 5)) parts.push(`  ${pct(r.returnPct).padStart(8)}  ${r.symbol || r.address?.slice(0, 8)} (${r.tier}, score ${r.score})`);
    if (measured.length > 5) {
      parts.push("Worst calls:");
      for (const r of measured.slice(-5).reverse()) parts.push(`  ${pct(r.returnPct).padStart(8)}  ${r.symbol || r.address?.slice(0, 8)} (${r.tier}, score ${r.score})`);
    }
  }
  parts.push("", "⚠️ Past performance is not predictive. Not financial advice.");
  console.log(parts.join("\n"));
}

export { computeReturn, summarize, median };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backtest.mjs")) {
  main().catch((e) => {
    console.error("[backtest] fatal:", e?.stack || e);
    process.exit(1);
  });
}
