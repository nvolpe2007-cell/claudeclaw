import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decodeDataUrl, type Comment, type NewPost, type Post, type StoreApi } from "./types";

// The production backend: Postgres for posts/comments/likes, Storage for the
// video files. Selected automatically in ./index.ts when the env vars below
// are set. Uses the service-role key, so this module is server-only (it's
// only ever imported by API routes / server components).

const BUCKET = "videos";

let cached: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** Best-effort file extension from a video mime type. */
function extFor(mime: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/x-matroska": "mkv",
  };
  return map[mime] ?? "mp4";
}

interface PostRow {
  id: string;
  task: string;
  caption: string | null;
  username: string;
  video_url: string;
  likes: number;
  created_at: string;
  comments?: CommentRow[];
}

interface CommentRow {
  id: string;
  username: string;
  text: string;
  created_at: string;
}

function toComment(row: CommentRow): Comment {
  return { id: row.id, username: row.username, text: row.text, createdAt: row.created_at };
}

function toPost(row: PostRow): Post {
  const comments = (row.comments ?? [])
    .map(toComment)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    id: row.id,
    task: row.task,
    caption: row.caption ?? "",
    username: row.username,
    video: row.video_url,
    likes: row.likes ?? 0,
    comments,
    createdAt: row.created_at,
  };
}

export const supabaseStore: StoreApi = {
  async getPosts() {
    const { data, error } = await db()
      .from("posts")
      .select("id, task, caption, username, video_url, likes, created_at, comments(id, username, text, created_at)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`getPosts failed: ${error.message}`);
    return (data as PostRow[]).map(toPost);
  },

  async addPost(input: NewPost) {
    const decoded = decodeDataUrl(input.video);
    if (!decoded) throw new Error("addPost: video is not a valid data URL.");

    const id = crypto.randomUUID();
    const objectPath = `${id}.${extFor(decoded.mime)}`;

    const upload = await db()
      .storage.from(BUCKET)
      .upload(objectPath, decoded.buffer, { contentType: decoded.mime, upsert: false });
    if (upload.error) throw new Error(`addPost: upload failed: ${upload.error.message}`);

    const videoUrl = db().storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

    const { data, error } = await db()
      .from("posts")
      .insert({
        id,
        task: input.task,
        caption: input.caption,
        username: input.username,
        video_url: videoUrl,
        likes: 0,
      })
      .select("id, task, caption, username, video_url, likes, created_at")
      .single();
    if (error) throw new Error(`addPost: insert failed: ${error.message}`);

    return toPost(data as PostRow);
  },

  async adjustLikes(id: string, delta: 1 | -1) {
    // Atomic increment via a Postgres function (see supabase/schema.sql).
    const { data, error } = await db().rpc("adjust_post_likes", { p_id: id, p_delta: delta });
    if (error) throw new Error(`adjustLikes failed: ${error.message}`);
    return data === null || data === undefined ? null : (data as number);
  },

  async addComment(id: string, input: { username: string; text: string }) {
    // Make sure the post exists so we can return null (→ 404) when it doesn't.
    const found = await db().from("posts").select("id").eq("id", id).maybeSingle();
    if (found.error) throw new Error(`addComment: lookup failed: ${found.error.message}`);
    if (!found.data) return null;

    const { data, error } = await db()
      .from("comments")
      .insert({ post_id: id, username: input.username, text: input.text })
      .select("id, username, text, created_at")
      .single();
    if (error) throw new Error(`addComment: insert failed: ${error.message}`);

    return toComment(data as CommentRow);
  },
};
