# Nudge — Web App & Feed (phase 2)

The web half of the social-norm challenge app. It closes the loop:

1. **Get a nudge** — the home page serves a random harmless dare (same list
   the iOS widget uses). Filter by mood with the category chips.
2. **Do it**, then **post your video** — a short proof clip + caption, tagged
   with the task.
3. **Watch the reel** — a vertical, snap-scrolling video feed of everyone's
   completed nudges (autoplay muted; tap a clip for sound). **Like** clips
   and leave **comments** from the reel.

Built with **Next.js (App Router) + TypeScript**, no CSS framework, and a
zero-config **file-based store** so it runs with no external accounts.

## Run it

```bash
cd web
npm install
npm run dev
# open http://localhost:3000
```

- `/` — the nudge generator (🎲 for a new one, mood chips, or "post my video").
- `/post` — record/upload a short video, add a caption, share to the reel.
- `/feed` — the vertical video reel of completed nudges.

## How it's wired

```
app/
├── page.tsx + generator.tsx   # home: random nudge + mood chips + actions
├── post/                      # posting flow (video upload → POST /api/posts)
├── feed/page.tsx + reel.tsx   # the vertical video reel (reads the store)
└── api/
    ├── task/random/route.ts   # GET  → { task, category }  (?category= filter)
    └── posts/
        ├── route.ts           # GET  → Post[]     POST → create a post
        └── [id]/
            ├── like/          # POST → { likes }  (op: like | unlike)
            └── comments/      # POST → Comment    (add a comment)
lib/
├── tasks.ts                   # categorized nudge list (mirrors Tasks.swift)
└── store/                     # swappable Post store
    ├── index.ts               #   picks a backend from env (file ↔ supabase)
    ├── file.ts                #   local JSON file (default, zero setup)
    ├── supabase.ts            #   Postgres + video Storage (when configured)
    └── types.ts               #   shared StoreApi contract
```

## Backends: file (default) or Supabase

The store has two interchangeable backends, chosen automatically by env vars:

- **File store (default, zero setup).** A JSON file at `data/posts.json` with
  videos inlined as base64 (capped ~30MB/clip). Perfect for local dev; not for
  real users.
- **Supabase (production).** Postgres for posts/comments/likes and a Storage
  bucket for the video files. Set the env vars and the app switches with **no
  code change** — same API, same UI. Setup: [`supabase/README.md`](./supabase/README.md).

Copy `.env.example` to `.env.local` to configure Supabase; leave it unset for
the file store.

## Phase 3 — status

- ✅ **Backend → Supabase.** Implemented as a swappable store
  (`lib/store/supabase.ts`) + schema (`supabase/schema.sql`). Opt in via env.
- ⏳ **Auth** — Supabase Auth for real accounts (the `user_id` columns are
  already in the schema); makes likes one-per-user instead of per-browser.
- ⏳ **Shared task list** — move `tasks.ts` into a `tasks` table so the widget
  and web app read one source via `GET /api/task/random`.
- ⏳ **Safety** — a report button + a moderation pass on new posts.
- ⏳ **Deploy** — Vercel for the app, Supabase for data + videos.
