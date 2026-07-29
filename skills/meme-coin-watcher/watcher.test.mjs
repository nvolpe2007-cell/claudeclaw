// Offline tests for the Meme Coin Watcher pipeline.
// Run: node skills/meme-coin-watcher/watcher.test.mjs
//
// These exercise the pure stages (extraction, on-chain normalization, the
// two-tier evaluator, and formatting) without any network access.

import {
  extractCandidates,
  pickBestPair,
  normalizeRug,
  evaluate,
  formatAlert,
  withDefaults,
} from "./watcher.mjs";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}

const CFG = withDefaults({});
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// --- extraction ------------------------------------------------------------
{
  const { addrs, cashtags } = extractCandidates(
    `New play $PEPE ca: ${BONK} — pump.fun/coin/${BONK} but $SOL and $USDC ignored`
  );
  assert(addrs.includes(BONK), "extracts contract address");
  assert(cashtags.includes("PEPE"), "extracts meme cashtag");
  assert(!cashtags.includes("SOL") && !cashtags.includes("USDC"), "filters major cashtags");
}

// --- pickBestPair (DexScreener shape) --------------------------------------
{
  const dex = pickBestPair(
    [
      { chainId: "ethereum", liquidity: { usd: 999999 }, baseToken: { symbol: "X" } },
      {
        chainId: "solana",
        baseToken: { address: BONK, symbol: "BONK", name: "Bonk" },
        priceUsd: "0.00001",
        liquidity: { usd: 50000 },
        marketCap: 1000000,
        fdv: 1000000,
        volume: { h24: 80000, m5: 2000 },
        priceChange: { h1: 12, h24: 40 },
        pairCreatedAt: Date.now() - 3600 * 1000,
        txns: { h24: { buys: 300, sells: 200 } },
        url: "https://dexscreener.com/solana/x",
      },
    ],
    "solana"
  );
  assert(dex && dex.symbol === "BONK", "picks the solana pair, not the higher-liq eth pair");
  assert(dex.buySellRatio === 1.5, "computes buy/sell ratio");
  assert(dex.ageSec >= 3500 && dex.ageSec <= 3700, "computes age");
}

// --- normalizeRug ----------------------------------------------------------
{
  const rug = normalizeRug({
    score: 200,
    mintAuthority: "",
    freezeAuthority: "",
    risks: [{ name: "Low amount of LP Providers" }],
    topHolders: [{ pct: 10 }, { pct: 8 }, { pct: 5 }],
    markets: [{ lp: { lpLockedPct: 100 } }],
  });
  assert(rug.mintRevoked === true, "mint revoked when authority empty");
  assert(rug.lpLockedOrBurned === true, "LP locked at 100%");
  assert(rug.top10Pct === 23, "sums top-10 holder pct");
}

// --- evaluate: CONFIRMED path ---------------------------------------------
{
  const token = {
    key: BONK,
    cashtag: "BONK",
    accounts: new Set(["ansem", "unipcs"]),
    mentions: 4,
    dex: {
      address: BONK, symbol: "BONK", name: "Bonk",
      liquidityUsd: 50000, marketCap: 500000, volume24hUsd: 90000,
      ageSec: 3600, buySellRatio: 1.4, buys24h: 300, sells24h: 210, priceChange1h: 15,
      dexUrl: "https://dexscreener.com/solana/x",
    },
    rug: { mintRevoked: true, lpLockedOrBurned: true, top10Pct: 20, rugged: false },
  };
  const r = evaluate(token, CFG);
  assert(r.tier === "confirmed", `2 KOLs + safe on-chain => confirmed (got ${r.tier}: ${r.fails.join("; ")})`);
  assert(r.score > 60, `strong token scores high (got ${r.score})`);
  const out = formatAlert(token, r);
  assert(out.includes("CONFIRMED") && out.includes("$BONK") && out.includes(BONK), "formats confirmed alert");
}

// --- evaluate: HEADS-UP path (1 account, thin but present liquidity) -------
{
  const token = {
    key: BONK, cashtag: "NEW",
    accounts: new Set(["ansem"]),
    mentions: 1,
    dex: {
      address: BONK, symbol: "NEW", name: "New",
      liquidityUsd: 4000, marketCap: 60000, volume24hUsd: 3000,
      ageSec: 1200, buySellRatio: 2, buys24h: 40, sells24h: 20,
      dexUrl: "https://dexscreener.com/solana/x",
    },
    rug: { mintRevoked: false, lpLockedOrBurned: true, top10Pct: 55, rugged: false },
  };
  const r = evaluate(token, CFG);
  assert(r.tier === "headsup", `1 caller + thin liq, fails confirmed => heads-up (got ${r.tier})`);
  assert(formatAlert(token, r).includes("HEADS-UP"), "formats heads-up alert");
}

// --- evaluate: rejected (rugged) ------------------------------------------
{
  const token = {
    key: BONK, cashtag: "RUG", accounts: new Set(["ansem", "x"]), mentions: 3,
    dex: { address: BONK, symbol: "RUG", liquidityUsd: 50000, marketCap: 500000, ageSec: 600 },
    rug: { rugged: true },
  };
  assert(evaluate(token, CFG).tier === null, "rugged token rejected");
}

// --- evaluate: rejected (too old) -----------------------------------------
{
  const token = {
    key: BONK, cashtag: "OLD", accounts: new Set(["a", "b"]), mentions: 3,
    dex: { address: BONK, symbol: "OLD", liquidityUsd: 50000, marketCap: 500000, ageSec: 100 * 3600 },
    rug: { mintRevoked: true, lpLockedOrBurned: true, top10Pct: 10, rugged: false },
  };
  assert(evaluate(token, CFG).tier === null, "token older than maxAgeHours rejected");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
