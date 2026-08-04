// Offline tests for the backtest math. No network.
// Run: node skills/meme-coin-watcher/backtest.test.mjs

import { computeReturn, summarize, median } from "./backtest.mjs";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}

// --- median ----------------------------------------------------------------
assert(median([]) === null, "median of empty is null");
assert(median([5]) === 5, "median of one");
assert(median([1, 3]) === 2, "median of two averages");
assert(median([3, 1, 2]) === 2, "median sorts first");

// --- computeReturn ---------------------------------------------------------
{
  const r = computeReturn(0.001, 0.003);
  assert(Math.abs(r.returnPct - 200) < 1e-6, "3x entry => +200%");
  assert(Math.abs(r.multiple - 3) < 1e-6, "3x entry => multiple 3");
  const down = computeReturn(0.002, 0.001);
  assert(Math.abs(down.returnPct + 50) < 1e-6, "halved => -50%");
  assert(computeReturn(0, 0.001) === null, "zero entry => null");
  assert(computeReturn(0.001, null) === null, "missing current => null");
  assert(computeReturn(null, 0.001) === null, "missing entry => null");
}

// --- summarize -------------------------------------------------------------
{
  const rows = [
    { tier: "confirmed", returnPct: 150 }, // hit (>=100), win
    { tier: "confirmed", returnPct: 20 },  // win, not hit
    { tier: "confirmed", returnPct: -40 }, // loss
    { tier: "confirmed", returnPct: null }, // unresolved
  ];
  const s = summarize(rows, 100);
  assert(s.count === 4, "counts all rows");
  assert(s.measured === 3 && s.unresolved === 1, "separates measured vs unresolved");
  assert(Math.abs(s.winRate - 2 / 3) < 1e-6, "win rate = 2/3 (positives over measured)");
  assert(Math.abs(s.hitRate - 1 / 3) < 1e-6, "hit rate = 1/3 (>=100% over measured)");
  assert(s.medianReturnPct === 20, "median of measured returns");
  assert(s.bestReturnPct === 150 && s.worstReturnPct === -40, "best/worst");
}

// --- summarize on peak key -------------------------------------------------
{
  const rows = [
    { peakReturnPct: 300 },
    { peakReturnPct: 80 },
    { peakReturnPct: undefined },
  ];
  const s = summarize(rows, 100, "peakReturnPct");
  assert(s.measured === 2, "peak summary counts only numeric peaks");
  assert(Math.abs(s.hitRate - 0.5) < 1e-6, "one of two peaks hit target");
}

// --- empty ----------------------------------------------------------------
{
  const s = summarize([], 100);
  assert(s.count === 0 && s.winRate === null && s.medianReturnPct === null, "empty summary is null-safe");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
