# Nudge on Supabase (phase 3 — backend)

By default the app runs on a local JSON file (no setup). Point it at Supabase
to get a real database, video storage, and persistence across users. **No code
changes** — the app auto-switches when the env vars are set.

## What Supabase replaces

| Local file store | Supabase |
| --- | --- |
| `data/posts.json` | `posts` + `comments` tables (Postgres) |
| base64 video inlined in JSON | video files in a public Storage bucket (`videos`) |
| in-process like counter | atomic `adjust_post_likes()` SQL function |

The swap lives entirely in `lib/store/` — `index.ts` chooses `supabase.ts`
over `file.ts` when the env vars below are present.

## Setup (about 10 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema.** Dashboard → SQL Editor → New query → paste all of
   [`schema.sql`](./schema.sql) → Run. This creates the tables, the like
   function, RLS policies, and the public `videos` storage bucket.
3. **Grab your keys.** Project Settings → API:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server only, secret**)
4. **Configure the app.** Copy `.env.example` to `.env.local` and paste the values.
5. **Run it.** `npm run dev`. On boot the store selects Supabase. Post a video —
   it uploads to the `videos` bucket and the row lands in `posts`.

To go back to the local file store, just unset the env vars.

## Verifying which backend is live

`lib/store` exports `BACKEND` (`"supabase"` or `"file"`). It's logged in
development on the first store call, so the terminal tells you which one you're on.

## Security notes

- The **service-role key bypasses RLS** and must never reach the browser. It's
  only imported by server code (`lib/store/supabase.ts`, used from API routes).
- Videos are in a **public** bucket so they can be played by `<video src>`.
  Fine for a public feed; if posts ever become private, switch to signed URLs.

## Still to come in phase 3

- **Auth** — Supabase Auth (magic link / OAuth) for real accounts; the
  `user_id` columns are already in the schema, ready to be filled in. This lets
  likes be one-per-user (a `post_likes` join table) instead of per-browser.
- **Moderation** — a report action + a review flag on posts.
- **Deploy** — host the Next.js app on Vercel with these same env vars.
