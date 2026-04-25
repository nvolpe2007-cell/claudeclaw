#!/bin/bash
# Auto-restart wrapper — keeps the bot running 24/7
# Usage: bash run_bot.sh
# Stop: Ctrl+C (or kill the process)

cd "$(dirname "$0")"

while true; do
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting bot..."
    python crypto/bot.py
    EXIT=$?
    if [ $EXIT -eq 130 ]; then
        # Ctrl+C — user intentionally stopped it
        echo "Bot stopped by user."
        exit 0
    fi
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Bot exited (code $EXIT) — restarting in 15s..."
    sleep 15
done
