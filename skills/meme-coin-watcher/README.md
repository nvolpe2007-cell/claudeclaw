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
   for liquidity, market cap, volume, age, and buy/sell counts, checked on
   **RugCheck** (free) for mint authority, LP lock/burn, and top-holder
   concentration, and — when a `BIRDEYE_API_KEY` is set — enriched with **Birdeye**
   holder count and unique-wallet growth. It also self-tracks holder count across
   scans to derive a holders/hour growth rate without a historical API.
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
- **holder-growth momentum** (Birdeye): holder count ≥ `minHolders` and 24h
  unique-wallet change ≥ `minHolderGrowthPct24h` — is the crowd actually growing,
  not just one caller's followers aping in. Enforced **only** when a
  `BIRDEYE_API_KEY` is present; skipped (never a blocker) without one.
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
   - `BIRDEYE_API_KEY` *(optional)* — enables holder-count and holder-growth
     momentum in the confirmed tier. Get one at
     [birdeye.so](https://docs.birdeye.so). Without it the watcher still runs;
     the holder-momentum gates are simply skipped.

3. **Test** (`--dry-run` doesn't write state, so real alerts aren't suppressed):
   ```bash
   X_API_KEY=... MEMECOIN_TELEGRAM_BOT_TOKEN=... MEMECOIN_TELEGRAM_CHAT_ID=... \
     node skills/meme-coin-watcher/watcher.mjs --verbose --dry-run
   ```

   Or just verify everything at once with the built-in doctor (validates keys,
   config, and channels, and can send a live test alert):
   ```bash
   node skills/meme-coin-watcher/watcher.mjs --check              # validate setup
   node skills/meme-coin-watcher/watcher.mjs --check --test-alert # + send a test alert
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

## Deploy to a VPS (24/7)

For an always-on setup, use the deploy kit in [`deploy/`](deploy/DEPLOY.md):

```bash
cp skills/meme-coin-watcher/.env.example skills/meme-coin-watcher/.env   # then edit it
bash skills/meme-coin-watcher/deploy/setup.sh                            # validates + starts under pm2
```

[`deploy/DEPLOY.md`](deploy/DEPLOY.md) is a full copy-paste runbook (Node install
→ clone → keys → run → survive reboots). A systemd unit is included as an
alternative to pm2. `setup.sh` runs the `--check` doctor and refuses to start
until the essentials are configured.

## Alert history & backtesting

Every fired alert is appended to `.claude/claudeclaw/meme-coin-watcher/alerts.jsonl`
(one JSON record per line) with an **entry snapshot** — price, market cap,
liquidity, tier, score, callers, holder count, timestamp. This is the raw
material for measuring whether the filter actually has an edge.

`backtest.mjs` replays that log: it re-prices each token now via DexScreener,
computes the return since entry, and reports win rate, hit rate at a target
multiple, and median/mean return — broken down by tier.

```bash
# Return-to-now for every logged alert, 2x target (default)
node skills/meme-coin-watcher/backtest.mjs

# Only alerts at least 24h old, last 7 days, 3x target, confirmed tier only
node skills/meme-coin-watcher/backtest.mjs --min-elapsed 24 --since 168 --target 200 --tier confirmed

# Peak-return view within 24h of each alert (needs BIRDEYE_API_KEY)
node skills/meme-coin-watcher/backtest.mjs --birdeye --horizon 24
```

Flags: `--file <path>`, `--since <hours>`, `--min-elapsed <hours>`,
`--target <pct>`, `--tier confirmed|headsup|all`, `--birdeye`,
`--horizon <hours>`, `--dead-as-zero` (count vanished pairs as −100%),
`--json`, `--limit <n>`, `--verbose`.

**Workflow:** let the watcher run for a couple of weeks to accumulate history,
then backtest with `--min-elapsed` set to the holding period you care about.
Use it to tune thresholds — if the confirmed tier's hit rate isn't beating the
heads-up tier's, the extra gates aren't earning their keep.

> Return-to-now compares the logged entry price to the live price, so run the
> backtest a while after the alerts fired. `--birdeye` adds the "could you have
> sold the peak" view using historical OHLCV. Past performance is not
> predictive — this measures the past, it does not promise the future.

## Data sources

| Source | Purpose | Cost |
| --- | --- | --- |
| twitterapi.io (or any X API) | KOL / cashtag tweets | ~$0.15/1k tweets |
| DexScreener API | liquidity, MC, volume, age, txns | free |
| RugCheck API | mint authority, LP lock, holders | free |
| Birdeye *(optional)* | holder count + holder-growth momentum | free tier / key |
| Telegram Bot API / Discord webhook | alert delivery | free |

## Tests

```bash
node skills/meme-coin-watcher/watcher.test.mjs   # engine: extraction, enrichment, tiers, formatting, history
node skills/meme-coin-watcher/backtest.test.mjs   # backtest math: returns, summary stats
```

Offline tests — no network required.
