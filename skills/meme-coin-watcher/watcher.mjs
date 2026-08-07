#!/usr/bin/env node
// Meme Coin Watcher — engine
//
// Polls X (Twitter) for meme-coin mentions from a curated watchlist of KOLs,
// extracts Solana token identifiers (contract addresses, pump.fun links,
// cashtags), enriches them with on-chain data (DexScreener + RugCheck), applies
// a two-tier filter modeled on how popular meme-coin traders screen early gems,
// and prints alerts. Designed to be run on a schedule by ClaudeClaw and have its
// output forwarded to Telegram/Discord.
//
// Runtime: Node 18+ or Bun (uses global fetch, no dependencies).
//
// Usage:
//   node watcher.mjs [--config <path>] [--json] [--dry-run] [--verbose]
//                    [--watch] [--interval <seconds>]
//
// Env:
//   X_API_KEY                     (required) key for the third-party X data provider
//   X_API_BASE_URL                (optional) default https://api.twitterapi.io
//   X_API_PROVIDER                (optional) default "twitterapi.io"
//   BIRDEYE_API_KEY               (optional) enables Birdeye enrichment if set
//   MEMECOIN_TELEGRAM_BOT_TOKEN   (optional) dedicated Telegram bot token — when
//   MEMECOIN_TELEGRAM_CHAT_ID     (optional) both are set, alerts are posted
//                                 directly to this chat.
//   MEMECOIN_DISCORD_WEBHOOK_URL  (optional) Discord channel webhook — when set,
//                                 alerts are posted to that channel.
//
// Telegram and Discord are independent: set either, both, or neither. Alerts are
// posted only when there ARE alerts (or a setup error); routine runs are silent.
//
// --watch runs the scan on a loop (default every 120s), the cheap way to get a
// 2-minute cadence without invoking Claude each time. Point a dedicated Telegram
// bot and/or a Discord webhook at it via the env vars above.
//
// Exit codes: always 0 on a normal run (including "no alerts" and "no API key"),
// so the scheduler does not treat routine states as errors. Non-zero only on a
// hard crash.

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------

function log(...args) {
  console.error("[meme-coin-watcher]", ...args);
}

function parseArgs(argv) {
  const args = {
    config: null, json: false, dryRun: false, verbose: false, watch: false,
    interval: null, check: false, testAlert: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--watch") args.watch = true;
    else if (a === "--interval") args.interval = Number(argv[++i]);
    else if (a === "--check") args.check = true;
    else if (a === "--test-alert") args.testAlert = true;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Post a message to a dedicated Telegram bot. Chunks to Telegram's 4096 limit. */
async function telegramSend(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const chunks = [];
  for (let i = 0; i < text.length; i += 3900) chunks.push(text.slice(i, i + 3900));
  for (const chunk of chunks) {
    const r = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!r.ok) log(`Telegram send failed: ${r.error || r.status}`);
  }
}

function telegramConfig(cfg) {
  const token = process.env.MEMECOIN_TELEGRAM_BOT_TOKEN || cfg?.telegram?.botToken || "";
  const chatId = process.env.MEMECOIN_TELEGRAM_CHAT_ID || cfg?.telegram?.chatId || "";
  return token && chatId ? { token, chatId } : null;
}

/** Post a message to a Discord channel via an incoming webhook. Chunks to Discord's 2000 limit. */
async function discordSend(webhookUrl, text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 1900) chunks.push(text.slice(i, i + 1900));
  for (const chunk of chunks) {
    // Discord webhooks return 204 No Content on success, so don't parse a body.
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: chunk, flags: 4 }), // flags:4 suppresses link embeds
      });
      if (!res.ok) log(`Discord send failed: HTTP ${res.status}`);
    } catch (e) {
      log(`Discord send failed: ${e?.message || e}`);
    }
  }
}

function discordConfig(cfg) {
  const webhookUrl = process.env.MEMECOIN_DISCORD_WEBHOOK_URL || cfg?.discord?.webhookUrl || "";
  return webhookUrl ? { webhookUrl } : null;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtAge(sec) {
  if (sec == null || !Number.isFinite(sec)) return "?";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

async function fetchJson(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// --------------------------------------------------------------------------
// Config + state
// --------------------------------------------------------------------------

const DEFAULT_STATE_DIR = join(process.cwd(), ".claude", "claudeclaw", "meme-coin-watcher");

async function loadConfig(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(isAbsolute(explicitPath) ? explicitPath : join(process.cwd(), explicitPath));
  candidates.push(join(DEFAULT_STATE_DIR, "config.json"));
  candidates.push(join(__dirname, "config.json"));
  candidates.push(join(__dirname, "config.example.json"));

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = await readFile(path, "utf8");
        return { config: withDefaults(JSON.parse(raw)), path };
      } catch (e) {
        log(`Failed to parse config at ${path}: ${e.message}`);
      }
    }
  }
  return { config: withDefaults({}), path: null };
}

function withDefaults(c) {
  const f = c.filters || {};
  return {
    chain: c.chain || "solana",
    watchlist: Array.isArray(c.watchlist) ? c.watchlist : [],
    // Broad, non-watchlist search for the aggressive tier. Off by default (noisy + costs more reads).
    broadSearch: {
      enabled: c.broadSearch?.enabled ?? false,
      minFollowers: c.broadSearch?.minFollowers ?? 5000,
      query: c.broadSearch?.query ?? '"pump.fun/coin"',
    },
    poll: {
      windowMinutes: c.poll?.windowMinutes ?? 30, // how far back to look each run
      handlesPerQuery: c.poll?.handlesPerQuery ?? 10,
      maxTokensEnriched: c.poll?.maxTokensEnriched ?? 25,
    },
    filters: {
      // Shared gates
      maxAgeHours: f.maxAgeHours ?? 72,
      minLiquidityUsd: f.minLiquidityUsd ?? 5000,
      // Aggressive "heads-up" tier
      aggressive: {
        enabled: f.aggressive?.enabled ?? true,
        minDistinctAccounts: f.aggressive?.minDistinctAccounts ?? 1,
        minLiquidityUsd: f.aggressive?.minLiquidityUsd ?? 3000,
      },
      // Balanced "confirmed" tier
      confirmed: {
        enabled: f.confirmed?.enabled ?? true,
        minDistinctAccounts: f.confirmed?.minDistinctAccounts ?? 2,
        minLiquidityUsd: f.confirmed?.minLiquidityUsd ?? 15000,
        // liquidity / market-cap ratio band (single most-cited early filter)
        minLiqMcapRatio: f.confirmed?.minLiqMcapRatio ?? 0.02,
        maxTop10HolderPct: f.confirmed?.maxTop10HolderPct ?? 40, // % of supply in top 10 holders
        requireMintRevoked: f.confirmed?.requireMintRevoked ?? true,
        requireLpLockedOrBurned: f.confirmed?.requireLpLockedOrBurned ?? true,
        minVolume24hUsd: f.confirmed?.minVolume24hUsd ?? 20000,
        minBuySellRatio: f.confirmed?.minBuySellRatio ?? 0.8, // buys/sells over 24h
        // Holder-growth momentum (Birdeye). Enforced ONLY when a BIRDEYE_API_KEY
        // is set and returns data — otherwise skipped, never a blocker.
        minHolders: f.confirmed?.minHolders ?? 50,
        minHolderGrowthPct24h: f.confirmed?.minHolderGrowthPct24h ?? 0, // % unique-wallet change; 0 = not shrinking
      },
    },
    // Re-alert an already-seen token only if it upgrades tier, or after this cooldown.
    realertCooldownMinutes: c.realertCooldownMinutes ?? 720,
    // Drop tokens from state after this many hours of no mentions.
    stateTtlHours: c.stateTtlHours ?? 72,
  };
}

const HISTORY_PATH = join(DEFAULT_STATE_DIR, "alerts.jsonl");

/** Flatten a fired alert into an append-only history record (entry snapshot). */
function alertHistoryRecord(a) {
  const d = a.token.dex || {};
  return {
    ts: nowSec(),
    isoTime: new Date().toISOString(),
    tier: a.evalResult.tier,
    upgraded: !!a.upgraded,
    score: a.evalResult.score,
    address: d.address || a.token.key || null,
    symbol: a.token.cashtag || d.symbol || null,
    entryPriceUsd: d.priceUsd ?? null,
    entryMarketCap: d.marketCap ?? null,
    entryLiquidityUsd: d.liquidityUsd ?? null,
    entryVolume24hUsd: d.volume24hUsd ?? null,
    ageSecAtAlert: d.ageSec ?? null,
    holders: a.token.momentum?.holders ?? null,
    accounts: [...a.token.accounts],
    mentions: a.token.mentions,
    reasons: a.evalResult.reasons,
  };
}

/** Append fired alerts to the JSONL history log (one record per line). */
async function appendAlertHistory(path, alerts) {
  if (!alerts.length) return;
  const lines = alerts.map((a) => JSON.stringify(alertHistoryRecord(a))).join("\n") + "\n";
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, lines, "utf8");
}

async function loadState(dir) {
  const path = join(dir, "state.json");
  if (existsSync(path)) {
    try {
      return { state: JSON.parse(await readFile(path, "utf8")), path };
    } catch {
      /* fall through to fresh */
    }
  }
  return { state: { tokens: {} }, path };
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// --------------------------------------------------------------------------
// X (Twitter) provider — pluggable. Default: twitterapi.io advanced search.
// --------------------------------------------------------------------------

function xProvider() {
  const key = process.env.X_API_KEY || "";
  const base = (process.env.X_API_BASE_URL || "https://api.twitterapi.io").replace(/\/$/, "");
  return {
    hasKey: !!key,
    /**
     * Run an advanced search. `query` uses standard X search operators.
     * Returns a normalized array of tweets: { id, text, url, createdAtSec, author, followers }.
     */
    async search(query, sinceSec) {
      if (!key) return { ok: false, error: "no-key", tweets: [] };
      const params = new URLSearchParams({ query, queryType: "Latest" });
      const url = `${base}/twitter/tweet/advanced_search?${params.toString()}`;
      const r = await fetchJson(url, { headers: { "x-api-key": key } });
      if (!r.ok) return { ok: false, error: r.error, tweets: [] };
      const raw = Array.isArray(r.data?.tweets) ? r.data.tweets : [];
      const tweets = [];
      for (const t of raw) {
        const createdAtSec = parseTweetTime(t.createdAt || t.created_at);
        if (sinceSec && createdAtSec && createdAtSec < sinceSec) continue;
        tweets.push({
          id: String(t.id || t.tweet_id || ""),
          text: String(t.text || t.full_text || ""),
          url: t.url || t.twitterUrl || "",
          createdAtSec,
          author: (t.author?.userName || t.author?.screen_name || t.username || "").toLowerCase(),
          followers: Number(t.author?.followers ?? t.author?.followers_count ?? 0) || 0,
        });
      }
      return { ok: true, tweets };
    },
  };
}

function parseTweetTime(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// --------------------------------------------------------------------------
// Token extraction from tweet text
// --------------------------------------------------------------------------

// Solana mint addresses are base58, 32-44 chars. This also matches many random
// tokens, so we validate every candidate against DexScreener before trusting it.
const SOL_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
// pump.fun and letsbonk.fun (which overtook pump.fun for daily Solana launches).
const LAUNCHPAD_RE = /(?:pump\.fun|letsbonk\.fun|moonshot\.money)\/(?:coin\/|token\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/gi;
const DEX_LINK_RE = /(?:dexscreener\.com|birdeye\.so|solscan\.io|jup\.ag|photon-sol\.tinyastro\.io|gmgn\.ai|bullx\.io)\/[^\s]*?([1-9A-HJ-NP-Za-km-z]{32,44})/gi;
const CASHTAG_RE = /\$([A-Za-z][A-Za-z0-9_]{1,14})\b/g;

/** Pull candidate token references out of a tweet. Prefers explicit links / "CA:". */
function extractCandidates(text) {
  const addrs = new Set();
  const cashtags = new Set();

  for (const m of text.matchAll(LAUNCHPAD_RE)) addrs.add(m[1]);
  for (const m of text.matchAll(DEX_LINK_RE)) addrs.add(m[1]);

  // Bare base58 blobs — only keep those that look address-like (>=32) and are
  // near a CA hint OR appear as a standalone token. We keep all and let the
  // DexScreener validation stage filter out non-tokens.
  for (const m of text.matchAll(SOL_ADDR_RE)) {
    const a = m[0];
    if (a.length >= 32) addrs.add(a);
  }

  for (const m of text.matchAll(CASHTAG_RE)) {
    const tag = m[1].toUpperCase();
    // skip obvious majors / fiat that aren't meme plays
    if (!["SOL", "BTC", "ETH", "USD", "USDC", "USDT", "BNB"].includes(tag)) cashtags.add(tag);
  }

  return { addrs: [...addrs], cashtags: [...cashtags] };
}

// --------------------------------------------------------------------------
// On-chain enrichment
// --------------------------------------------------------------------------

/** DexScreener: resolve a token address to its best (highest-liquidity) pair. */
async function dexByAddress(address) {
  const r = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!r.ok) return null;
  return pickBestPair(r.data?.pairs, "solana");
}

/** DexScreener search by cashtag/symbol — best-effort resolution for tickers. */
async function dexBySymbol(symbol) {
  const r = await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`);
  if (!r.ok) return null;
  return pickBestPair(r.data?.pairs, "solana");
}

function pickBestPair(pairs, chain) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const filtered = pairs.filter((p) => !chain || p.chainId === chain);
  const pool = filtered.length ? filtered : [];
  if (!pool.length) return null;
  pool.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pool[0];
  const createdSec = p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null;
  const buys = p.txns?.h24?.buys ?? 0;
  const sells = p.txns?.h24?.sells ?? 0;
  return {
    address: p.baseToken?.address || "",
    symbol: p.baseToken?.symbol || "",
    name: p.baseToken?.name || "",
    priceUsd: Number(p.priceUsd) || null,
    liquidityUsd: p.liquidity?.usd ?? null,
    marketCap: p.marketCap ?? p.fdv ?? null,
    fdv: p.fdv ?? null,
    volume24hUsd: p.volume?.h24 ?? null,
    volume5mUsd: p.volume?.m5 ?? null,
    priceChange1h: p.priceChange?.h1 ?? null,
    priceChange24h: p.priceChange?.h24 ?? null,
    ageSec: createdSec ? nowSec() - createdSec : null,
    buys24h: buys,
    sells24h: sells,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? Infinity : null,
    dexUrl: p.url || (p.baseToken?.address ? `https://dexscreener.com/solana/${p.baseToken.address}` : ""),
  };
}

/** RugCheck (free): mint authority, LP lock/burn, top-holder concentration. */
async function rugCheck(address) {
  const r = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`);
  if (!r.ok) {
    // fall back to the full report endpoint
    const full = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${address}/report`);
    if (!full.ok) return null;
    return normalizeRug(full.data);
  }
  return normalizeRug(r.data);
}

function normalizeRug(d) {
  if (!d || typeof d !== "object") return null;
  const risks = Array.isArray(d.risks) ? d.risks : [];
  const riskNames = risks.map((x) => String(x.name || "").toLowerCase());
  const topHolders = Array.isArray(d.topHolders) ? d.topHolders : [];
  const top10Pct = topHolders
    .slice(0, 10)
    .reduce((sum, h) => sum + (Number(h.pct) || 0), 0);
  return {
    score: d.score ?? d.score_normalised ?? null,
    mintRevoked: d.mintAuthority == null || d.mintAuthority === "" ? true
      : riskNames.some((n) => n.includes("mint authority")) ? false : true,
    freezeRevoked: d.freezeAuthority == null || d.freezeAuthority === "" ? true : false,
    lpLockedPct: d.markets?.[0]?.lp?.lpLockedPct ?? null,
    lpLockedOrBurned:
      (d.markets?.[0]?.lp?.lpLockedPct ?? 0) >= 90 ||
      riskNames.some((n) => n.includes("burn")) ||
      !riskNames.some((n) => n.includes("liquidity") && n.includes("unlock")),
    top10Pct: top10Pct > 0 ? top10Pct : null,
    rugged: d.rugged === true,
    risks: riskNames,
  };
}

/**
 * Birdeye token overview (optional — requires BIRDEYE_API_KEY). Provides holder
 * count and short-window unique-wallet momentum, which the confirmed tier uses
 * as a "is the crowd actually growing" signal. Returns null when no key / on error.
 */
async function birdeyeOverview(address) {
  const key = process.env.BIRDEYE_API_KEY || "";
  if (!key) return null;
  const r = await fetchJson(
    `https://public-api.birdeye.so/defi/token_overview?address=${address}`,
    { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } }
  );
  if (!r.ok) return null;
  const d = r.data?.data;
  if (!d || typeof d !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    holders: num(d.holder),
    uniqueWallet24h: num(d.uniqueWallet24h),
    // percent change in unique wallets over the last 24h — our holder-growth momentum
    holderGrowthPct24h: num(d.uniqueWallet24hChangePercent),
    uniqueWallet1h: num(d.uniqueWallet1h),
    holderGrowthPct1h: num(d.uniqueWallet1hChangePercent),
  };
}

/**
 * Combine a Birdeye reading with any holder count we recorded for this token on
 * a previous scan, yielding a self-tracked growth rate that doesn't depend on a
 * historical API. `prev` is the persisted state entry for the token (or null).
 */
function holderMomentum(birdeye, prev) {
  const holders = birdeye?.holders ?? null;
  let selfGrowthPerHour = null;
  if (holders != null && prev?.holders != null && prev?.holdersAtSec) {
    const dtHours = (nowSec() - prev.holdersAtSec) / 3600;
    if (dtHours > 0.01) selfGrowthPerHour = (holders - prev.holders) / dtHours;
  }
  return {
    holders,
    growthPct24h: birdeye?.holderGrowthPct24h ?? null,
    growthPct1h: birdeye?.holderGrowthPct1h ?? null,
    selfGrowthPerHour, // holders added per hour, measured across our own scans
  };
}

// --------------------------------------------------------------------------
// Filtering / scoring
// --------------------------------------------------------------------------

/**
 * Evaluate a token against the two-tier filter. Returns
 * { tier: "confirmed"|"headsup"|null, score, reasons[], fails[] }.
 */
function evaluate(token, cfg) {
  const f = cfg.filters;
  const dex = token.dex;
  const rug = token.rug;
  const reasons = [];
  const fails = [];

  // Shared hard gates -------------------------------------------------------
  if (!dex) {
    return { tier: null, score: 0, reasons, fails: ["no on-chain data (unresolved token)"] };
  }
  if (rug?.rugged) return { tier: null, score: 0, reasons, fails: ["flagged as rugged"] };

  const ageHours = dex.ageSec != null ? dex.ageSec / 3600 : null;
  if (ageHours != null && ageHours > f.maxAgeHours) {
    fails.push(`too old (${fmtAge(dex.ageSec)} > ${f.maxAgeHours}h)`);
  }

  const distinct = token.accounts.size;
  const liq = dex.liquidityUsd ?? 0;
  const liqMcapRatio = dex.marketCap ? liq / dex.marketCap : null;
  const mom = token.momentum || null; // holder-growth momentum (Birdeye), may be null

  // Score (0-100) — social velocity + liquidity + safety + momentum --------
  let score = 0;
  score += Math.min(26, distinct * 11); // social breadth
  score += Math.min(13, token.mentions * 2); // social volume
  if (liq >= f.minLiquidityUsd) score += 10;
  if (liqMcapRatio != null && liqMcapRatio >= f.confirmed.minLiqMcapRatio) score += 9;
  if (rug?.mintRevoked) score += 7;
  if (rug?.lpLockedOrBurned) score += 7;
  if (rug?.top10Pct != null && rug.top10Pct <= f.confirmed.maxTop10HolderPct) score += 6;
  if ((dex.volume24hUsd ?? 0) >= f.confirmed.minVolume24hUsd) score += 5;
  if (dex.buySellRatio != null && dex.buySellRatio >= f.confirmed.minBuySellRatio) score += 5;
  // Holder-growth momentum (up to 12 pts): 24h unique-wallet change + self-tracked rate.
  if (mom?.growthPct24h != null && mom.growthPct24h > 0)
    score += Math.min(8, mom.growthPct24h / 5); // +40% 24h → full 8
  if (mom?.selfGrowthPerHour != null && mom.selfGrowthPerHour > 0)
    score += Math.min(4, mom.selfGrowthPerHour / 25); // +100 holders/hr → full 4
  score = Math.min(100, Math.round(score));

  // Confirmed (balanced) tier ----------------------------------------------
  if (f.confirmed.enabled && (ageHours == null || ageHours <= f.maxAgeHours)) {
    const c = f.confirmed;
    const cf = [];
    if (distinct < c.minDistinctAccounts) cf.push(`only ${distinct} distinct account(s)`);
    if (liq < c.minLiquidityUsd) cf.push(`liquidity ${fmtUsd(liq)} < ${fmtUsd(c.minLiquidityUsd)}`);
    if (liqMcapRatio != null && liqMcapRatio < c.minLiqMcapRatio)
      cf.push(`liq/mcap ${liqMcapRatio.toFixed(3)} < ${c.minLiqMcapRatio}`);
    if (c.requireMintRevoked && rug && rug.mintRevoked === false) cf.push("mint authority not revoked");
    if (c.requireLpLockedOrBurned && rug && rug.lpLockedOrBurned === false) cf.push("LP not locked/burned");
    if (rug?.top10Pct != null && rug.top10Pct > c.maxTop10HolderPct)
      cf.push(`top-10 hold ${rug.top10Pct.toFixed(0)}% > ${c.maxTop10HolderPct}%`);
    if ((dex.volume24hUsd ?? 0) < c.minVolume24hUsd)
      cf.push(`24h vol ${fmtUsd(dex.volume24hUsd)} < ${fmtUsd(c.minVolume24hUsd)}`);
    if (dex.buySellRatio != null && dex.buySellRatio < c.minBuySellRatio)
      cf.push(`buy/sell ${dex.buySellRatio.toFixed(2)} < ${c.minBuySellRatio}`);
    // Holder-growth momentum gates — enforced only when Birdeye data is present,
    // so users without a BIRDEYE_API_KEY are never blocked by them.
    if (mom?.holders != null && c.minHolders > 0 && mom.holders < c.minHolders)
      cf.push(`holders ${mom.holders} < ${c.minHolders}`);
    if (mom?.growthPct24h != null && c.minHolderGrowthPct24h != null && mom.growthPct24h < c.minHolderGrowthPct24h)
      cf.push(`holder growth ${mom.growthPct24h.toFixed(0)}% < ${c.minHolderGrowthPct24h}% (24h)`);

    if (cf.length === 0) {
      reasons.push(
        `${distinct} KOLs, liq ${fmtUsd(liq)}` +
          (liqMcapRatio != null ? `, liq/mcap ${(liqMcapRatio * 100).toFixed(1)}%` : "") +
          (rug?.mintRevoked ? ", mint revoked" : "") +
          (rug?.lpLockedOrBurned ? ", LP safe" : "") +
          (mom?.holders != null ? `, ${mom.holders} holders` : "") +
          (mom?.growthPct24h != null ? ` (${mom.growthPct24h > 0 ? "+" : ""}${mom.growthPct24h.toFixed(0)}% 24h)` : "")
      );
      return { tier: "confirmed", score, reasons, fails };
    }
    fails.push(...cf);
  }

  // Aggressive (heads-up) tier ---------------------------------------------
  if (f.aggressive.enabled && (ageHours == null || ageHours <= f.maxAgeHours)) {
    const a = f.aggressive;
    if (distinct >= a.minDistinctAccounts && liq >= a.minLiquidityUsd && !(rug?.rugged)) {
      reasons.push(`early: ${distinct} account(s), liq ${fmtUsd(liq)}, age ${fmtAge(dex.ageSec)}`);
      return { tier: "headsup", score, reasons, fails };
    }
    if (distinct < a.minDistinctAccounts) fails.push(`< ${a.minDistinctAccounts} account(s) for heads-up`);
    if (liq < a.minLiquidityUsd) fails.push(`liquidity ${fmtUsd(liq)} < ${fmtUsd(a.minLiquidityUsd)} heads-up floor`);
  }

  return { tier: null, score, reasons, fails };
}

// --------------------------------------------------------------------------
// Alert formatting
// --------------------------------------------------------------------------

function formatAlert(token, evalResult) {
  const dex = token.dex;
  const rug = token.rug;
  const badge = evalResult.tier === "confirmed" ? "✅ CONFIRMED" : "⚡ HEADS-UP";
  const sym = dex?.symbol ? `$${dex.symbol}` : token.cashtag ? `$${token.cashtag}` : "(unknown)";
  const name = dex?.name ? ` — ${dex.name}` : "";
  const accounts = [...token.accounts].slice(0, 6).map((a) => `@${a}`).join(", ");
  const moreAccounts = token.accounts.size > 6 ? ` +${token.accounts.size - 6}` : "";

  const lines = [];
  lines.push(`${badge}  ${sym}${name}  ·  score ${evalResult.score}/100`);
  if (dex) {
    const parts = [
      `Liq ${fmtUsd(dex.liquidityUsd)}`,
      `MC ${fmtUsd(dex.marketCap)}`,
      `Vol24h ${fmtUsd(dex.volume24hUsd)}`,
      `Age ${fmtAge(dex.ageSec)}`,
    ];
    if (dex.priceChange1h != null) parts.push(`1h ${dex.priceChange1h > 0 ? "+" : ""}${dex.priceChange1h}%`);
    lines.push(parts.join("  ·  "));
    if (dex.buys24h != null) lines.push(`Buys/Sells 24h: ${dex.buys24h}/${dex.sells24h}`);
  }
  if (rug) {
    const safety = [
      rug.mintRevoked ? "mint✅" : "mint⚠️",
      rug.lpLockedOrBurned ? "LP✅" : "LP⚠️",
      rug.top10Pct != null ? `top10 ${rug.top10Pct.toFixed(0)}%` : null,
    ].filter(Boolean);
    lines.push(`Safety: ${safety.join("  ")}`);
  }
  const mom = token.momentum;
  if (mom && (mom.holders != null || mom.growthPct24h != null || mom.selfGrowthPerHour != null)) {
    const parts = [];
    if (mom.holders != null) parts.push(`${mom.holders} holders`);
    if (mom.growthPct24h != null) parts.push(`${mom.growthPct24h > 0 ? "+" : ""}${mom.growthPct24h.toFixed(0)}% 24h`);
    if (mom.selfGrowthPerHour != null) parts.push(`${mom.selfGrowthPerHour > 0 ? "+" : ""}${mom.selfGrowthPerHour.toFixed(0)}/hr`);
    lines.push(`Holders: ${parts.join("  ·  ")}`);
  }
  lines.push(`Called by: ${accounts}${moreAccounts} (${token.mentions} mentions)`);
  if (evalResult.reasons.length) lines.push(`Why: ${evalResult.reasons.join("; ")}`);
  if (dex?.address) lines.push(`CA: ${dex.address}`);
  if (dex?.dexUrl) lines.push(dex.dexUrl);
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

/**
 * Run a single scan. Pure of I/O side effects except reading the network and
 * writing state; returns a result object so the caller decides how to emit.
 * Result: { setupError?, text, json, alerts }.
 */
async function runScan(args, cfg, state, statePath) {
  const x = xProvider();

  if (!x.hasKey) {
    return {
      setupError: true,
      alerts: [],
      json: { ok: false, error: "no-x-key", alerts: [] },
      text:
        "Meme Coin Watcher is not configured: missing X_API_KEY.\n" +
        "Set an X data-provider key (e.g. twitterapi.io) in the environment, then re-run.\n" +
        "See skills/meme-coin-watcher/README.md for setup.",
    };
  }

  if (cfg.watchlist.length === 0) {
    return {
      setupError: true,
      alerts: [],
      json: { ok: false, error: "empty-watchlist", alerts: [] },
      text: "Meme Coin Watcher: watchlist is empty. Add KOL handles to config.json.",
    };
  }

  const sinceSec = nowSec() - cfg.poll.windowMinutes * 60;

  // 1) Collect tweets from the watchlist (chunked `from:` queries) -----------
  const handles = cfg.watchlist.map((w) => (typeof w === "string" ? w : w.handle)).filter(Boolean).map((h) => h.replace(/^@/, ""));
  const chunks = [];
  for (let i = 0; i < handles.length; i += cfg.poll.handlesPerQuery) {
    chunks.push(handles.slice(i, i + cfg.poll.handlesPerQuery));
  }

  const tweets = [];
  const errors = [];
  for (const chunk of chunks) {
    const q = `(${chunk.map((h) => `from:${h}`).join(" OR ")})`;
    const r = await x.search(q, sinceSec);
    if (r.ok) tweets.push(...r.tweets);
    else errors.push(r.error);
  }

  // Optional broad, non-watchlist discovery for the aggressive tier ---------
  if (cfg.broadSearch.enabled) {
    const r = await x.search(cfg.broadSearch.query, sinceSec);
    if (r.ok) {
      for (const t of r.tweets) {
        if (t.followers >= cfg.broadSearch.minFollowers) tweets.push(t);
      }
    } else {
      errors.push(r.error);
    }
  }

  if (args.verbose) log(`fetched ${tweets.length} tweets (${errors.length} query errors)`);

  // 2) Aggregate mentions per token ----------------------------------------
  //    key by contract address when available, else by cashtag.
  const byAddr = new Map(); // address -> { accounts:Set, mentions, latestSec }
  const byTag = new Map(); // CASHTAG -> same

  for (const t of tweets) {
    const { addrs, cashtags } = extractCandidates(t.text);
    for (const a of addrs) {
      if (!byAddr.has(a)) byAddr.set(a, { accounts: new Set(), mentions: 0, latestSec: 0 });
      const e = byAddr.get(a);
      e.accounts.add(t.author || "unknown");
      e.mentions++;
      e.latestSec = Math.max(e.latestSec, t.createdAtSec || 0);
    }
    // Only count cashtags when no address is present in the same tweet, to avoid
    // double-counting the token's own ticker alongside its CA.
    if (addrs.length === 0) {
      for (const tag of cashtags) {
        if (!byTag.has(tag)) byTag.set(tag, { accounts: new Set(), mentions: 0, latestSec: 0 });
        const e = byTag.get(tag);
        e.accounts.add(t.author || "unknown");
        e.mentions++;
        e.latestSec = Math.max(e.latestSec, t.createdAtSec || 0);
      }
    }
  }

  // 3) Build candidate list, prioritized by distinct-account count ----------
  const candidates = [];
  for (const [addr, e] of byAddr) candidates.push({ kind: "addr", key: addr, ...e });
  for (const [tag, e] of byTag) candidates.push({ kind: "tag", key: tag, cashtag: tag, ...e });
  candidates.sort((a, b) => b.accounts.size - a.accounts.size || b.mentions - a.mentions);
  const limited = candidates.slice(0, cfg.poll.maxTokensEnriched);

  // 4) Enrich + evaluate ----------------------------------------------------
  const alerts = [];
  for (const cand of limited) {
    let dex = null;
    if (cand.kind === "addr") dex = await dexByAddress(cand.key);
    else dex = await dexBySymbol(cand.key);

    // Skip base58 blobs that don't resolve to a real token (addresses only).
    if (!dex && cand.kind === "addr") continue;

    const address = dex?.address || (cand.kind === "addr" ? cand.key : null);
    let rug = null;
    let birdeye = null;
    if (address && cfg.chain === "solana") {
      rug = await rugCheck(address);
      birdeye = await birdeyeOverview(address); // null unless BIRDEYE_API_KEY set
    }

    const tokenKey = address || cand.key;
    const momentum = holderMomentum(birdeye, state.tokens[tokenKey]);

    const token = {
      key: tokenKey,
      cashtag: cand.cashtag || dex?.symbol || null,
      accounts: cand.accounts,
      mentions: cand.mentions,
      latestSec: cand.latestSec,
      dex,
      rug,
      birdeye,
      momentum,
    };

    const evalResult = evaluate(token, cfg);
    if (!evalResult.tier) {
      if (args.verbose) log(`skip ${token.cashtag || token.key}: ${evalResult.fails.join("; ")}`);
      continue;
    }

    // 5) Dedup against state -------------------------------------------------
    const prev = state.tokens[token.key];
    const upgraded = prev && prev.tier === "headsup" && evalResult.tier === "confirmed";
    const cooled = prev && nowSec() - (prev.lastAlertSec || 0) > cfg.realertCooldownMinutes * 60;
    const isNew = !prev;

    // Carry a holder reading forward for next scan's self-tracked momentum.
    const freshHolders = token.momentum?.holders ?? null;
    const holders = freshHolders != null ? freshHolders : prev?.holders ?? null;
    const holdersAtSec = freshHolders != null ? nowSec() : prev?.holdersAtSec ?? null;

    if (!isNew && !upgraded && !cooled) {
      if (args.verbose) log(`dedup ${token.cashtag || token.key} (already ${prev.tier})`);
      // refresh last-seen (TTL) and the holder reading, without re-alerting
      state.tokens[token.key] = { ...prev, lastSeenSec: nowSec(), holders, holdersAtSec };
      continue;
    }

    alerts.push({ token, evalResult, upgraded });
    state.tokens[token.key] = {
      tier: evalResult.tier,
      score: evalResult.score,
      symbol: token.cashtag || dex?.symbol || null,
      lastAlertSec: nowSec(),
      lastSeenSec: nowSec(),
      holders,
      holdersAtSec,
    };
  }

  // 6) TTL cleanup ----------------------------------------------------------
  const cutoff = nowSec() - cfg.stateTtlHours * 3600;
  for (const [k, v] of Object.entries(state.tokens)) {
    if ((v.lastSeenSec || v.lastAlertSec || 0) < cutoff) delete state.tokens[k];
  }

  if (!args.dryRun) {
    await saveState(statePath, state);
    await appendAlertHistory(HISTORY_PATH, alerts); // record entry snapshots for backtesting
  }

  // 7) Output ---------------------------------------------------------------
  // Confirmed first, then heads-up; each by score desc.
  alerts.sort((a, b) => {
    const tierRank = (t) => (t === "confirmed" ? 1 : 0);
    return tierRank(b.evalResult.tier) - tierRank(a.evalResult.tier) || b.evalResult.score - a.evalResult.score;
  });

  const json = {
    ok: true,
    scanned: { tweets: tweets.length, candidates: candidates.length, enriched: limited.length },
    alerts: alerts.map((a) => ({
      tier: a.evalResult.tier,
      upgraded: a.upgraded,
      score: a.evalResult.score,
      symbol: a.token.cashtag || a.token.dex?.symbol || null,
      address: a.token.dex?.address || null,
      accounts: [...a.token.accounts],
      mentions: a.token.mentions,
      dex: a.token.dex,
      rug: a.token.rug,
      momentum: a.token.momentum,
      reasons: a.evalResult.reasons,
    })),
  };

  let text;
  if (alerts.length === 0) {
    text =
      `No meme-coin alerts this run. Scanned ${tweets.length} tweets from ${handles.length} accounts, ` +
      `${candidates.length} candidate tokens, none cleared the filters.`;
  } else {
    const header =
      `🚨 ${alerts.length} meme-coin alert${alerts.length > 1 ? "s" : ""} ` +
      `(${alerts.filter((a) => a.evalResult.tier === "confirmed").length} confirmed, ` +
      `${alerts.filter((a) => a.evalResult.tier === "headsup").length} heads-up)`;
    const blocks = alerts.map((a) => {
      const upg = a.upgraded ? "  ⬆️ upgraded to confirmed" : "";
      return formatAlert(a.token, a.evalResult) + upg;
    });
    text = [header, "", ...blocks.flatMap((b) => [b, ""])].join("\n").trim();
  }

  return { alerts, json, text };
}

/** Emit a scan result: print to stdout, and post to Telegram when there are alerts. */
async function emit(result, args, cfg) {
  if (args.json) {
    console.log(JSON.stringify(result.json, null, 2));
  } else {
    console.log(result.text);
  }

  // Post to the alert channels only when there is something worth sending:
  // real alerts, or a setup error (so the user learns setup is broken).
  if (result.alerts.length > 0 || result.setupError) {
    const tg = telegramConfig(cfg);
    if (tg) await telegramSend(tg.token, tg.chatId, result.text);
    const dc = discordConfig(cfg);
    if (dc) await discordSend(dc.webhookUrl, result.text);
  }
}

/**
 * Setup doctor: validate env, config, and channels; optionally send a test
 * alert. Exits non-zero when the essentials (X key + non-empty watchlist +
 * at least one alert channel) are missing, so deploy scripts can gate on it.
 */
async function runCheck(args) {
  const { config: cfg, path: cfgPath } = await loadConfig(args.config);
  const x = xProvider();
  const tg = telegramConfig(cfg);
  const dc = discordConfig(cfg);
  const lines = [];
  const ok = (label, good, detail) => lines.push(`  ${good ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  const info = (label, detail) => lines.push(`  •  ${label}${detail ? ` — ${detail}` : ""}`);

  lines.push("Meme Coin Watcher — setup check\n");

  // Config
  ok("config.json", !!cfgPath, cfgPath || "not found (using defaults) — copy config.example.json");
  ok("watchlist", cfg.watchlist.length > 0, `${cfg.watchlist.length} account(s)`);

  // X API key — validate live with a tiny query when possible
  let xOk = x.hasKey;
  let xDetail = x.hasKey ? "key present" : "missing X_API_KEY";
  if (x.hasKey) {
    const probe = await x.search("(from:jack)", nowSec() - 7 * 24 * 3600);
    if (!probe.ok) {
      xOk = false;
      xDetail = `key present but request failed (${probe.error}) — check the key / provider`;
    } else {
      xDetail = "key present and a live query succeeded";
    }
  }
  ok("X API (twitterapi.io)", xOk, xDetail);

  // Channels
  const anyChannel = !!tg || !!dc;
  ok("alert channel", anyChannel, anyChannel ? [tg && "Telegram", dc && "Discord"].filter(Boolean).join(" + ") : "none — set Telegram and/or Discord env vars");
  info("Birdeye momentum", process.env.BIRDEYE_API_KEY ? "enabled" : "disabled (optional — set BIRDEYE_API_KEY)");

  const essentialsOk = xOk && cfg.watchlist.length > 0 && anyChannel;

  // Optional live test alert
  if (args.testAlert) {
    lines.push("");
    if (!anyChannel) {
      lines.push("  ⚠️ --test-alert skipped: no channel configured.");
    } else {
      const sample =
        "🚨 Meme Coin Watcher — TEST ALERT\n" +
        "✅ CONFIRMED  $TEST — Test Token  ·  score 88/100\n" +
        "Liq $42.0K  ·  MC $310K  ·  Vol24h $120K  ·  Age 2h\n" +
        "Safety: mint✅  LP✅  top10 18%\n" +
        "Holders: 640  ·  +35% 24h\n" +
        "If you can read this in your channel, delivery works.";
      if (tg) { await telegramSend(tg.token, tg.chatId, sample); lines.push("  📨 Test alert sent to Telegram."); }
      if (dc) { await discordSend(dc.webhookUrl, sample); lines.push("  📨 Test alert sent to Discord."); }
    }
  }

  lines.push("");
  lines.push(essentialsOk ? "READY ✅ — essentials configured. Start with: watcher.mjs --watch" : "NOT READY ❌ — fix the ❌ items above.");

  if (args.json) {
    console.log(JSON.stringify({
      ok: essentialsOk,
      config: cfgPath, watchlist: cfg.watchlist.length,
      xApi: xOk, telegram: !!tg, discord: !!dc, birdeye: !!process.env.BIRDEYE_API_KEY,
    }, null, 2));
  } else {
    console.log(lines.join("\n"));
  }
  return essentialsOk;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    const ready = await runCheck(args);
    process.exitCode = ready ? 0 : 1;
    return;
  }

  async function once() {
    // Reload config + state each pass so live edits (thresholds, watchlist) and
    // persisted dedup state take effect without a restart.
    const { config: cfg, path: cfgPath } = await loadConfig(args.config);
    const { state, path: statePath } = await loadState(DEFAULT_STATE_DIR);
    if (args.verbose) log(`config: ${cfgPath || "(defaults)"}  watchlist: ${cfg.watchlist.length} accounts`);
    const result = await runScan(args, cfg, state, statePath);
    await emit(result, args, cfg);
    return result;
  }

  if (!args.watch) {
    await once();
    return;
  }

  // Watch loop — the cheap way to run a 2-minute cadence with no Claude tokens.
  const intervalSec = Number.isFinite(args.interval) && args.interval > 0 ? args.interval : 120;
  log(`watch mode: scanning every ${intervalSec}s (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await once();
    } catch (e) {
      log("scan error:", e?.message || e);
    }
    await sleep(intervalSec * 1000);
  }
}

// Exported for testing. The pipeline stages are pure and can be exercised
// without network access.
export {
  extractCandidates,
  pickBestPair,
  normalizeRug,
  evaluate,
  formatAlert,
  withDefaults,
  fmtUsd,
  fmtAge,
  telegramConfig,
  discordConfig,
  holderMomentum,
  alertHistoryRecord,
  dexByAddress,
};

// Only run the watcher when executed directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("watcher.mjs")) {
  main().catch((e) => {
    log("fatal:", e?.stack || e);
    process.exit(1);
  });
}
