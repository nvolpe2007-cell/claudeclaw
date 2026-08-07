---
schedule: "*/2 * * * *"
recurring: true
notify: error
---
Run the meme-coin watcher once. Execute exactly this command and nothing else:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.mjs
```

The script posts any alerts to its own alert channels itself — Telegram (via
MEMECOIN_TELEGRAM_BOT_TOKEN / MEMECOIN_TELEGRAM_CHAT_ID) and/or Discord (via
MEMECOIN_DISCORD_WEBHOOK_URL) — so you do NOT need to relay its output. Reply
with exactly: OK

Notes:
- `notify: error` means ClaudeClaw only pings you if the command exits non-zero
  (a real crash). Routine "no alerts" runs stay completely silent.
- This is not financial advice — never recommend buying anything.

> NOTE: This ClaudeClaw job spins up a Claude session every 2 minutes just to
> exec the script, which costs tokens. For a 24/7 2-minute cadence the cheaper,
> more reliable option is the standalone watch loop (no Claude tokens per scan):
>
>     node ${CLAUDE_PLUGIN_ROOT}/skills/meme-coin-watcher/watcher.mjs --watch
>
> Run it as a background process with the X + Telegram env vars set. See
> README.md. Use this job only if you specifically want the agent supervising
> the runs.
