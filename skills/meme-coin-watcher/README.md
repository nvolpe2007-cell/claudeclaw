# Meme Coin Watcher

A ClaudeClaw skill that watches X (Twitter) for Solana meme coins that may be
about to run, using the kind of filters popular meme-coin traders actually
screen with, and pushes alerts to a dedicated Telegram bot.

> ⚠️ **Not financial advice.** Meme coins are extremely high-risk. The large
> majority go to zero and rug pulls are common. This tool surfaces *candidates*
> and *safety signals* — it never tells you to buy. Always do your own research,
> and never risk more than you can afford to lose.

## How it works

```
X watchlist (KOLs)  →  extract token refs  →  on-chain enrichment  →  two-tier filter  →  Telegram
 twitterapi.io           CA / pump.fun /        DexScreener +           heads-up /          + Discord
 (from: search)          letsbonk / $tags       RugCheck                confirmed
```

1. **Social signal.** Every ~2 minutes it pulls recent tweets from a curated
   watchlist of meme-coin KOLs (chunked `from:` searches via a third-party X
   API). Optionally it can also scan broader crypto-Twitter for pump.fun links
   from high-follower accounts (`broadSearch`, off by default).
2. **Token extraction.** From each tweet it pulls Solana contract addresses,
   launchpad links (`pump.fun`, `letsbonk.fun`, `moonshot.money`), explorer /
   chart links (DexScreener, Birdeye, Solscan, GMGN, BullX), and `$cashtags`
   (majors like `$SOL`/`$BTC` are ignored). As of 2026 LetsBonk overtook pump.fun
   for daily Solana launches, so both launchpads are covered.
3. **Aggregation.** It groups mentions per token over a rolling window and counts
   how many *distinct* accounts called it — velocity/breadth of smart mentions
   matters more than raw volume.
4. **On-chain enrichment.** Each candidate is resolved on **DexScreener** (free)
   for liquidity, market cap, volume, age, and buy/sell counts, and checked on
   **RugCheck** (free) for mint authority, LP lock/burn, and top-holder
   concentration.
5. **Two-tier filter** (below).
6. **Alerting.** New qualifying tokens are posted to your dedicated Telegram bot
   and/or a Discord channel webhook (independent — use either or both). A token
   re-alerts only when it upgrades heads-up → confirmed, or after the re-alert
   cooldown. State is persisted so you don't get spammed.

## The two tiers (why these filters)

These mirror what meme-coin traders repeatedly cite as their early screens:

**⚡ Heads-up (aggressive)** — earliest social signal, minimal on-chain gate:
- ≥ `aggressive.minDistinctAccounts` watchlist account(s) mention it
- liquidity ≥ `aggressive.minLiquidityUsd`
- not flagged rugged, token age under the cap

More alerts, more noise, earliest entries.

**✅ Confirmed (balanced)** — multiple credible callers **and** on-chain safety:
- ≥ `confirmed.minDistinctAccounts` distinct accounts (default 2)
- liquidity ≥ `confirmed.minLiquidityUsd`
- **liquidity / market-cap ratio** ≥ `minLiqMcapRatio` — the single most-cited
  early filter; a thin float against a big "market cap" is a classic trap
- mint authority revoked (`requireMintRevoked`)
- LP locked or burned (`requireLpLockedOrBurned`)
- top-10 holder concentration ≤ `maxTop10HolderPct` (bundled/insider check)
- 24h volume ≥ `minVolume24hUsd`, buy/sell ratio ≥ `minBuySellRatio`
- token age ≤ `maxAgeHours`

Fewer, higher-quality alerts. Every threshold lives in `config.json`.

Each alert also carries a 0–100 **score** blending social breadth + liquidity +
safety + momentum, so you can eyeball conviction at a glance.

## Setup

1. **Config** (once):
   ```bash
   mkdir -p .claude/claudeclaw/meme-coin-watcher
   cp skills/meme-coin-watcher/config.example.json .claude/claudeclaw/meme-coin-watcher/config.json
   ```
   Edit `config.json` and curate the `watchlist` — it ships with a seed list of
   well-known Solana meme KOLs, but **verify and replace it with the callers you
   actually trust**. Handles change and accounts get compromised.

2. **Keys / env.**
   - `X_API_KEY` — a third-party X data-provider key. [twitterapi.io](https://twitterapi.io)
     is the cheap default (~$0.15 / 1k tweets). Override the host with
     `X_API_BASE_URL` if you use a different provider.
   - **Telegram** *(optional)* — `MEMECOIN_TELEGRAM_BOT_TOKEN` from a
     **dedicated** bot via [@BotFather](https://t.me/BotFather), and
     `MEMECOIN_TELEGRAM_CHAT_ID`, your numeric id from
     [@userinfobot](https://t.me/userinfobot). Send your new bot a message once
     first so it can DM you.
   - **Discord** *(optional)* — `MEMECOIN_DISCORD_WEBHOOK_URL`. In Discord:
     Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
   - Set Telegram, Discord, both, or neither (neither = print to stdout only).
   - `BIRDEYE_API_KEY` *(optional)* — reserved for future Birdeye enrichment.

3. **Test** (`--dry-run` doesn't write state, so real alerts aren't suppressed):
   ```bash
   X_API_KEY=... MEMECOIN_TELEGRAM_BOT_TOKEN=... MEMECOIN_TELEGRAM_CHAT_ID=... \
     node skills/meme-coin-watcher/watcher.mjs --verbose --dry-run
   ```

4. **Run on a schedule** — pick one:
   - **Standalone watch loop (recommended):** one long-lived process, no Claude
     tokens per scan.
     ```bash
     nohup node skills/meme-coin-watcher/watcher.mjs --watch \
       > .claude/claudeclaw/meme-coin-watcher/watch.log 2>&1 &
     ```
   - **ClaudeClaw cron job (agent-supervised):**
     ```bash
     cp skills/meme-coin-watcher/job.template.md .claude/claudeclaw/jobs/meme-coin-watcher.md
     ```
     Restart the daemon so it loads the job; make sure the daemon process carries
     the env vars above. Costs a Claude session every 2 minutes — only worth it
     if you want the agent in the loop.

## CLI

```
node watcher.mjs [--json] [--dry-run] [--verbose] [--watch] [--interval <seconds>] [--config <path>]
```

- `--json` — machine-readable output instead of chat text.
- `--dry-run` — don't persist dedup state.
- `--watch` — loop forever (default 120s; `--interval` overrides).
- `--config` — explicit config path (else the runtime path, else the bundled example).

Exit code is `0` on any normal run (including "no alerts" and "not configured"),
so a scheduler never treats routine states as failures.

## Tuning

- **More / earlier alerts:** lower `confirmed.minDistinctAccounts`, lower the
  liquidity floors, enable `broadSearch`, or shorten the interval.
- **Fewer / safer alerts:** raise `confirmed.minDistinctAccounts`, raise
  `minLiquidityUsd` / `minLiqMcapRatio` / `minVolume24hUsd`, lower
  `maxTop10HolderPct`.

Config is re-read every scan, so edits take effect without a restart.

## Data sources

| Source | Purpose | Cost |
| --- | --- | --- |
| twitterapi.io (or any X API) | KOL / cashtag tweets | ~$0.15/1k tweets |
| DexScreener API | liquidity, MC, volume, age, txns | free |
| RugCheck API | mint authority, LP lock, holders | free |
| Birdeye *(optional)* | extra enrichment | free tier / key |
| Telegram Bot API / Discord webhook | alert delivery | free |

## Tests

```bash
node skills/meme-coin-watcher/watcher.test.mjs
```

Offline tests for extraction, on-chain normalization, the two-tier evaluator,
and formatting — no network required.
