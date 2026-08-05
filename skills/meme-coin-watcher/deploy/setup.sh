#!/usr/bin/env bash
# One-command deploy for the Meme Coin Watcher on a VPS (or any always-on box).
#
# It validates your setup, scaffolds the runtime config, and starts the watcher
# 24/7 under pm2 (auto-restart + survive reboots). Idempotent — safe to re-run.
#
# Usage:
#   1. cp skills/meme-coin-watcher/.env.example skills/meme-coin-watcher/.env
#   2. edit that .env with your keys
#   3. bash skills/meme-coin-watcher/deploy/setup.sh
#
# Env overrides:
#   ENV_FILE     path to the env file (default: <skill>/.env)
#   WATCHER_CWD  working dir where .claude/ state lives (default: repo root)

set -euo pipefail

# --- resolve paths ----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
WATCHER_CWD="${WATCHER_CWD:-$REPO_ROOT}"
ENV_FILE="${ENV_FILE:-$SKILL_DIR/.env}"
WATCHER="$SKILL_DIR/watcher.mjs"

echo "▶ Meme Coin Watcher deploy"
echo "  skill dir : $SKILL_DIR"
echo "  work dir  : $WATCHER_CWD  (.claude/ state lives here)"
echo "  env file  : $ENV_FILE"
echo

# --- runtime check ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js not found. Install Node 18+ first (e.g. via nvm or your package manager)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node $(node -v) is too old. Node 18+ is required (global fetch)." >&2
  exit 1
fi
echo "✅ Node $(node -v)"

# --- env --------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No env file at $ENV_FILE" >&2
  echo "   Run: cp \"$SKILL_DIR/.env.example\" \"$ENV_FILE\"  then edit it." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
echo "✅ Loaded env from $ENV_FILE"

# --- config scaffold --------------------------------------------------------
CFG_DIR="$WATCHER_CWD/.claude/claudeclaw/meme-coin-watcher"
mkdir -p "$CFG_DIR"
if [ ! -f "$CFG_DIR/config.json" ]; then
  cp "$SKILL_DIR/config.example.json" "$CFG_DIR/config.json"
  echo "✅ Created $CFG_DIR/config.json"
  echo "   ⚠️  Edit its 'watchlist' — replace the seed handles with callers you trust."
else
  echo "✅ Config already present: $CFG_DIR/config.json"
fi

# --- validate (doctor) ------------------------------------------------------
echo
echo "▶ Running setup check…"
if ! ( cd "$WATCHER_CWD" && node "$WATCHER" --check ); then
  echo
  echo "❌ Setup check failed. Fix the items above (edit $ENV_FILE), then re-run." >&2
  exit 1
fi

# --- pm2 --------------------------------------------------------------------
if ! command -v pm2 >/dev/null 2>&1; then
  echo
  echo "▶ Installing pm2 (process manager)…"
  npm install -g pm2
fi

echo
echo "▶ Starting the watcher under pm2…"
# Replace any existing instance so re-runs pick up new env/args.
pm2 delete memecoin-watcher >/dev/null 2>&1 || true
pm2 start "$WATCHER" \
  --name memecoin-watcher \
  --cwd "$WATCHER_CWD" \
  --update-env \
  -- --watch
pm2 save

echo
echo "✅ Deployed. The watcher is polling every 2 minutes and posting alerts."
echo
echo "Next steps:"
echo "  • Make it survive reboots (run the command pm2 prints):"
echo "      pm2 startup"
echo "  • Tail logs:        pm2 logs memecoin-watcher"
echo "  • Send a test alert: ( cd \"$WATCHER_CWD\" && node \"$WATCHER\" --check --test-alert )"
echo "  • Backtest later:    ( cd \"$WATCHER_CWD\" && node \"$SKILL_DIR/backtest.mjs\" --min-elapsed 24 )"
