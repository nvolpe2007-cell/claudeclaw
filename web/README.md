# Nudge — Web App & Feed (phase 2)

The web half of the social-norm challenge app. It closes the loop:

1. **Get a nudge** — the home page serves a random harmless dare (same list
   the iOS widget uses).
2. **Do it**, then **post proof** — a photo + caption, tagged with the task.
3. **Browse the feed** — everyone's completed nudges, newest first.

Built with **Next.js (App Router) + TypeScript**, no CSS framework, and a
zero-config **file-based store** so it runs with no external accounts.

## Run it

```bash
cd web
npm install
npm run dev
# open http://localhost:3000
```

- `/` — the nudge generator (🎲 for a new one, or "post proof").
- `/post` — upload a photo, add a caption, share to the feed.
- `/feed` — the shared feed of completed nudges.

## How it's wired

```
app/
├── page.tsx + generator.tsx   # home: random nudge + actions
├── post/                      # posting flow (client form → POST /api/posts)
├── feed/page.tsx              # the feed (reads the store directly)
└── api/
    ├── task/random/route.ts   # GET  → { task }   (also feeds the widget, phase 3)
    └── posts/route.ts         # GET  → Post[]     POST → create a post
lib/
├── tasks.ts                   # the nudge list (mirrors the widget's Tasks.swift)
└── store.ts                   # file-based Post store (the Supabase seam)
```

## Prototype limitations (by design)

- **Storage** is a JSON file at `data/posts.json`; photos are inlined as
  base64 data URLs. Fine for local dev, not for production or many users.
- **No auth** — username is just a text field.
- Feed content isn't moderated yet.

## Phase 3 — make it real

The code is structured so this is a swap, not a rewrite:

- **Backend → Supabase.** Replace `lib/store.ts` with Supabase calls
  (Postgres `posts` table + a Storage bucket for photos). The `getPosts()` /
  `addPost()` signatures stay the same, so the API routes don't change.
- **Auth** — add Supabase Auth for real accounts; drop the free-text username.
- **Shared task list** — move `tasks.ts` into a `tasks` table; the widget's
  `TaskProvider` and this app both fetch `GET /api/task/random`.
- **Safety** — add a report button + a moderation pass on new posts.
- **Deploy** — Vercel hosts the Next.js app; Supabase hosts data + photos.
