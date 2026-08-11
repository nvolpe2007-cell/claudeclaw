-- Nudge — Supabase schema (phase 3)
-- Run once per project in the Supabase SQL editor (Dashboard → SQL → New query)
-- or with the Supabase CLI. Safe to re-run (idempotent).

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  task       text not null,
  caption    text default '',
  username   text not null,
  video_url  text not null,
  likes      integer not null default 0,
  user_id    uuid references auth.users (id) on delete set null, -- for the auth slice
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  username   text not null,
  text       text not null,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists posts_created_at_idx on public.posts (created_at desc);

-- ── Atomic like counter ─────────────────────────────────────────────────
-- Returns the new like count, or NULL if no post matched (→ the API 404s).
create or replace function public.adjust_post_likes(p_id uuid, p_delta int)
returns integer
language plpgsql
as $$
declare
  new_likes integer;
begin
  update public.posts
     set likes = greatest(0, likes + p_delta)
   where id = p_id
   returning likes into new_likes;
  return new_likes;
end;
$$;

-- ── Row Level Security ──────────────────────────────────────────────────
-- The server talks to Supabase with the service-role key, which bypasses RLS,
-- so writes are already gated by our API routes. These SELECT policies let a
-- browser read the feed directly later (e.g. realtime), and the storage
-- policy makes uploaded videos publicly playable.
alter table public.posts enable row level security;
alter table public.comments enable row level security;

drop policy if exists "posts are public" on public.posts;
create policy "posts are public" on public.posts for select using (true);

drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select using (true);

-- ── Storage bucket for videos (public read) ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do nothing;

drop policy if exists "public read videos" on storage.objects;
create policy "public read videos" on storage.objects
  for select using (bucket_id = 'videos');
