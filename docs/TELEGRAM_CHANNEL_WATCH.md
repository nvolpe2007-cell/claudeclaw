# Telegram Channel Watch

ClaudeClaw can watch one or more Telegram channels and react to every new post —
either by forwarding the post to you or by summarizing it through Claude.

## How it works

Telegram delivers a **`channel_post`** update to a bot only when that bot is an
**administrator** of the channel. ClaudeClaw subscribes to `channel_post` and
`edited_channel_post` updates in its long-polling loop and routes them to a
dedicated handler (`handleChannelPost` in `src/commands/telegram.ts`), separate
from the direct-message / group handler.

```
Telegram getUpdates ──► channel_post ──► handleChannelPost
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        │                                             │
                   mode: "forward"                            mode: "summarize"
                        │                                             │
              relay raw post text                     run(prompt, thread "channel:<id>")
                        │                                             │
                        └──────────────► sendMessage(notifyChatId) ◄──┘
```

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token into
   `telegram.token` (the setup wizard does this for you).
2. Add the bot to your channel as an **administrator**. It does not need any
   posting rights — admin status is only required so Telegram forwards the posts.
3. Enable the watcher in `.claude/claudeclaw/settings.json`:

   ```json
   {
     "telegram": {
       "token": "<bot-token>",
       "allowedUserIds": [123456789],
       "channelWatch": {
         "enabled": true,
         "channels": ["@my_channel", "-1001234567890"],
         "notifyChatId": 0,
         "mode": "summarize"
       }
     }
   }
   ```

4. Restart the daemon (or the Telegram command). On startup you'll see:

   ```
   Channel watch: enabled (mode=summarize, channels=@my_channel, -1001234567890)
   ```

## Configuration

| Field          | Type                       | Description |
| -------------- | -------------------------- | ----------- |
| `enabled`      | `boolean`                  | Master switch for the watcher. |
| `channels`     | `string[]`                 | Channels to watch: usernames (`@name` or `name`) or numeric ids (`-100…`). An empty array watches **every** channel the bot administers. |
| `notifyChatId` | `number`                   | Chat id that receives the output. `0` falls back to the first entry in `allowedUserIds`. |
| `mode`         | `"forward" \| "summarize"` | `forward` relays the raw post text; `summarize` sends it through Claude. |

### Matching rules

A post is processed when `channels` is empty, or when an entry matches the
channel by:

- numeric id (`-1001234567890`), with or without the `-100` supergroup prefix, or
- username (`@my_channel` / `my_channel`, case-insensitive).

## Modes

### `forward`

The raw post text (or `(image)` / `(no text)` when there is no body) is relayed to
`notifyChatId`, prefixed with the channel name and a `t.me` link when the channel
is public.

### `summarize`

The post — including any attached image — is handed to Claude with a request to
summarize it in 1–3 sentences and flag anything that needs attention. Each
channel runs in its **own isolated session** (thread id `channel:<chat-id>`), so a
channel's history never mixes into your direct-message or group conversation, and
different channels don't block one another.

## Notes & limitations

- The bot **must** be a channel administrator; regular members receive no posts.
- Private channels can only be targeted by numeric id (they have no username), and
  their posts won't include a `t.me` link.
- Only text and image posts are handled. Other media (video, polls, service
  messages) are ignored.
- Existing direct-message and group behavior is unchanged — the channel watcher is
  entirely additive and off by default.
