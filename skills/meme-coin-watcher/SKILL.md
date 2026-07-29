---
name: meme-coin-watcher
description: Watch X (Twitter) for Solana meme coins about to run, using the filters popular meme-coin traders use. Use when the user wants a meme coin watcher, memecoin alerts, pump.fun scanner, crypto KOL tracker, cashtag monitor, early gem finder, degen alpha bot, or Solana token sniping signals. Trigger phrases include "meme coin watcher", "memecoin alerts", "watch twitter for coins", "pump.fun scanner", "KOL tracker", "find early gems", "crypto alpha", "token sniper alerts".
---

# Meme Coin Watcher

Polls X (Twitter) for meme-coin mentions from a curated watchlist of KOLs,
extracts Solana token identifiers, enriches them with on-chain data
(DexScreener + RugCheck), applies a two-tier filter modeled on how popular
meme-coin traders screen early gems, and emits alerts. In ClaudeClaw it runs as
a scheduled job whose output is forwarded to Telegram/Discord.

> ⚠️ Not financial advice. Meme coins are extremely high-risk; most go to zero
> and rug pulls are common. This tool surfaces candidates and safety signals —
> it does not tell you to buy. Always do your own research.

## The engine

`watcher.mjs` (in this skill's folder) is a self-contained Node/Bun script, no
dependencies. Run it directly:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.mjs [--json] [--dry-run] [--verbose]
```

It reads config from the first of: `--config <path>`,
`.claude/claudeclaw/meme-coin-watcher/config.json`, then the bundled
`config.example.json`. State (already-alerted tokens) lives in
`.claude/claudeclaw/meme-coin-watcher/state.json`.

Required env: `X_API_KEY` (a third-party X data-provider key, e.g.
twitterapi.io). Optional: `X_API_BASE_URL`, `BIRDEYE_API_KEY`. With no key the
script prints a setup message and exits 0 (never error-spams the scheduler).

For alerts, point a **dedicated** Telegram bot at it (the user wanted a separate
bot for this): set `MEMECOIN_TELEGRAM_BOT_TOKEN` and `MEMECOIN_TELEGRAM_CHAT_ID`.
When both are set the script posts alerts directly to that chat — only when
there ARE alerts, silent otherwise. `--watch` runs the scan on a loop (default
120s), the cheap way to get a 2-minute cadence without invoking Claude per scan.

## Two-tier filter (what the traders actually screen for)

- **⚡ Heads-up (aggressive):** earliest social signal — ≥1 watchlist account
  mentions a token that has a minimal liquidity floor and isn't flagged rugged.
  More alerts, more noise; catches the earliest entries.
- **✅ Confirmed (balanced):** ≥2 distinct credible callers **and** on-chain
  safety — liquidity floor, liquidity/market-cap ratio band (the single
  most-cited early filter), mint authority revoked, LP locked/burned, top-10
  holder concentration under a cap, healthy 24h volume and buy/sell ratio, token
  age under a cap. Fewer, higher-quality alerts.

Every threshold is editable in `config.json`. A token re-alerts only when it
upgrades heads-up → confirmed or after the re-alert cooldown.

## Setup (do this when the user asks to set up the watcher)

1. **Create the runtime config** (once):
   ```bash
   mkdir -p .claude/claudeclaw/meme-coin-watcher
   cp ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/config.example.json .claude/claudeclaw/meme-coin-watcher/config.json
   ```
   Then open `config.json` and help the user curate the `watchlist` — it ships
   with a seed list of well-known Solana meme KOLs, but they should add the
   callers they actually trust and remove any they don't.

2. **Provide the X API key and dedicated Telegram bot.** Ask the user for:
   - a third-party X data-provider key (twitterapi.io is the cheap default at
     ~$0.15/1k tweets) → `X_API_KEY`
   - a dedicated Telegram bot token from `@BotFather` → `MEMECOIN_TELEGRAM_BOT_TOKEN`
   - their Telegram chat/user id (from `@userinfobot`) → `MEMECOIN_TELEGRAM_CHAT_ID`

   Put these in the environment that runs the watcher. A simple `.env` the user
   sources works, e.g.:
   ```bash
   export X_API_KEY="..."
   export MEMECOIN_TELEGRAM_BOT_TOKEN="..."
   export MEMECOIN_TELEGRAM_CHAT_ID="..."
   ```

3. **Test it** before relying on the schedule (`--dry-run` skips writing state so
   the test doesn't suppress the first real alerts):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.mjs --verbose --dry-run
   ```

4. **Run it on a schedule.** Two options — recommend the first:
   - **Standalone watch loop (recommended, no Claude tokens per scan):**
     ```bash
     nohup node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.mjs --watch \
       > .claude/claudeclaw/meme-coin-watcher/watch.log 2>&1 &
     ```
     Runs every 2 minutes and posts alerts to the dedicated bot itself.
   - **ClaudeClaw job (agent-supervised, costs tokens every run):**
     ```bash
     mkdir -p .claude/claudeclaw/jobs
     cp ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/job.template.md .claude/claudeclaw/jobs/meme-coin-watcher.md
     ```
     Jobs load at daemon startup, so restart the daemon (or run
     `/claudeclaw:start`) after adding it. The daemon must carry the same env
     vars. The script still posts alerts to the dedicated bot; `notify: error`
     keeps ClaudeClaw silent unless the command crashes.

## When invoked to run a scan interactively

Run the engine, then relay the output to the user verbatim (it's already
formatted for chat). If the user asks to tune sensitivity, edit the thresholds
in `.claude/claudeclaw/meme-coin-watcher/config.json`:
- More/earlier alerts → lower `confirmed.minDistinctAccounts`, lower liquidity
  floors, enable `broadSearch`, or shorten the job schedule.
- Fewer/safer alerts → raise `confirmed.minDistinctAccounts`, raise
  `minLiquidityUsd`/`minLiqMcapRatio`/`minVolume24hUsd`, lower
  `maxTop10HolderPct`.

## Tests

`node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.test.mjs` runs the
offline pipeline tests (extraction, on-chain normalization, tiering, formatting)
with no network access.
