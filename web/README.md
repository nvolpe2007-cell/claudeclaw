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
└── store.ts                   # file-based Post store (the Supabase seam)
```

## Prototype limitations (by design)

- **Storage** is a JSON file at `data/posts.json`; videos are inlined as
  base64 data URLs (capped ~30MB/clip). Fine for a few short clips locally,
  not for production or many users — phase 3 moves videos to object storage.
- **No auth** — username is just a text field; a browser's "liked" state is
  kept in `localStorage`, so likes aren't tied to real accounts yet.
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
