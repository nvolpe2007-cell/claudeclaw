# Deploy the Meme Coin Watcher to a VPS

Copy-paste runbook to get the watcher running 24/7 on a fresh Linux VPS
(Ubuntu/Debian assumed). ~10 minutes.

> Not financial advice. Meme coins are extremely high-risk. This surfaces
> candidates and safety signals, never a recommendation to buy.

## 0. Get a VPS

Any small always-on box works — Hetzner, DigitalOcean, Vultr, etc. The smallest
tier (1 vCPU / 1 GB, ~$4–6/mo) is plenty. Create it with Ubuntu 22.04+ and SSH in:

```bash
ssh root@YOUR_SERVER_IP
```

(Optional but recommended: create a non-root user and use it instead of root.)

## 1. Install Node.js 18+ and git

```bash
sudo apt update && sudo apt install -y git curl
# Node 20 LTS via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v18+ (v20.x)
```

## 2. Clone the repo and check out the branch

```bash
git clone https://github.com/nvolpe2007-cell/claudeclaw.git
cd claudeclaw
git checkout claude/twitter-meme-coin-watcher-z0q78e
```

## 3. Create and fill the env file

```bash
cp skills/meme-coin-watcher/.env.example skills/meme-coin-watcher/.env
nano skills/meme-coin-watcher/.env    # paste your keys, save (Ctrl-O, Enter, Ctrl-X)
```

You need at minimum `X_API_KEY` and **one** channel (Telegram *or* Discord). See
the main README for where each key comes from.

## 4. Curate the watchlist

```bash
mkdir -p .claude/claudeclaw/meme-coin-watcher
cp skills/meme-coin-watcher/config.example.json .claude/claudeclaw/meme-coin-watcher/config.json
nano .claude/claudeclaw/meme-coin-watcher/config.json   # edit "watchlist"
```

(The setup script in step 5 also creates this file if you skip it — but the
watchlist is the thing that actually matters, so edit it.)

## 5. Run the one-command deploy

```bash
bash skills/meme-coin-watcher/deploy/setup.sh
```

This validates your setup (`--check`), installs pm2, and starts the watcher on a
2-minute loop. If the check fails it tells you exactly what's missing.

Then make it survive reboots — run the command pm2 prints:

```bash
pm2 startup      # copy-paste the sudo command it outputs
pm2 save
```

## 6. Confirm delivery

Send a live test alert to your channel(s):

```bash
node skills/meme-coin-watcher/watcher.mjs --check --test-alert
```

You should get a "TEST ALERT" in Telegram/Discord within a couple of seconds.

## Day-to-day

```bash
pm2 logs memecoin-watcher      # live logs
pm2 status                     # is it running?
pm2 restart memecoin-watcher   # after editing config or .env
pm2 stop memecoin-watcher      # pause alerts
```

Config is re-read every scan, so editing
`.claude/claudeclaw/meme-coin-watcher/config.json` takes effect without a
restart. Editing `.env` (keys) does need `pm2 restart`.

## Update to the latest code

```bash
cd ~/claudeclaw
git pull
pm2 restart memecoin-watcher
```

## Measure whether it works (after ~1–2 weeks)

```bash
node skills/meme-coin-watcher/backtest.mjs --min-elapsed 24
```

## Alternative: systemd instead of pm2

If you prefer systemd, edit `deploy/memecoin-watcher.service` (replace the
`REPLACE_WITH_USER` placeholders and paths), then:

```bash
sudo cp skills/meme-coin-watcher/deploy/memecoin-watcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now memecoin-watcher
journalctl -u memecoin-watcher -f
```

## Troubleshooting

- **`--check` says X API failed** — wrong/expired key, or no credit on the
  provider. Re-check `X_API_KEY` in `.env`, then `pm2 restart memecoin-watcher`.
- **No alerts ever** — that's often correct (few tokens clear the filter).
  Confirm the pipeline with `--test-alert`, and temporarily lower
  `confirmed.minDistinctAccounts`/liquidity floors to see it fire.
- **Alerts stopped** — `pm2 logs memecoin-watcher` for errors; check the X
  provider still has credit.
- **Costs creeping up** — raise the poll interval (`--interval` in the pm2 args,
  or the ClaudeClaw job schedule) or trim the watchlist; X reads dominate cost.
