import { fileStore } from "./file";
import { supabaseStore } from "./supabase";
import type { StoreApi } from "./types";

export type { Post, Comment, NewPost } from "./types";

// Use Supabase when it's configured; otherwise fall back to the zero-config
// local file store. This lets the app run with no setup during development
// and switch to the real backend just by setting env vars — no code change.
const useSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

const store: StoreApi = useSupabase ? supabaseStore : fileStore;

export const BACKEND = useSupabase ? "supabase" : "file";

if (process.env.NODE_ENV !== "production") {
  console.info(`[nudge] storage backend: ${BACKEND}`);
}

export const getPosts = store.getPosts.bind(store);
export const addPost = store.addPost.bind(store);
export const adjustLikes = store.adjustLikes.bind(store);
export const addComment = store.addComment.bind(store);
