import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// A tiny JSON-file store for the feed. It keeps the prototype runnable with
// zero external accounts. It is NOT meant for production — concurrent writes
// aren't transactional and videos are stored inline as base64 (fine for a few
// short clips locally, not for real users). Phase 3 replaces this whole file
// with Supabase (Postgres + storage bucket); the Post shape and the functions
// below are the seam that makes that swap a drop-in — the API routes call
// these helpers and don't care what's behind them.

export interface Comment {
  id: string;
  username: string;
  text: string;
  createdAt: string; // ISO timestamp
}

export interface Post {
  id: string;
  task: string;
  caption: string;
  username: string;
  /** Data URL (e.g. "data:video/mp4;base64,...") for the proof video. */
  video: string;
  likes: number;
  comments: Comment[];
  createdAt: string; // ISO timestamp
}

export interface NewPost {
  task: string;
  caption: string;
  username: string;
  video: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");

/** Fill in likes/comments for any record written before they existed. */
function normalize(post: Partial<Post>): Post {
  return {
    id: String(post.id ?? crypto.randomUUID()),
    task: String(post.task ?? ""),
    caption: String(post.caption ?? ""),
    username: String(post.username ?? ""),
    video: String(post.video ?? ""),
    likes: typeof post.likes === "number" && post.likes > 0 ? post.likes : 0,
    comments: Array.isArray(post.comments) ? (post.comments as Comment[]) : [],
    createdAt: String(post.createdAt ?? new Date().toISOString()),
  };
}

async function readAll(): Promise<Post[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    // File missing or unreadable → start empty.
    return [];
  }
}

async function writeAll(posts: Post[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(posts, null, 2), "utf8");
}

/** Newest-first list of completed nudges. */
export async function getPosts(): Promise<Post[]> {
  const posts = await readAll();
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Append a new post and return the stored record. */
export async function addPost(input: NewPost): Promise<Post> {
  const posts = await readAll();
  const post: Post = {
    id: crypto.randomUUID(),
    task: input.task,
    caption: input.caption,
    username: input.username,
    video: input.video,
    likes: 0,
    comments: [],
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  await writeAll(posts);
  return post;
}

/**
 * Adjust a post's like count by +1 or -1 (clamped at 0) and return the new
 * count. Returns null if the post doesn't exist. There's no per-user identity
 * in the prototype, so the client tracks its own liked state; this just moves
 * the counter.
 */
export async function adjustLikes(id: string, delta: 1 | -1): Promise<number | null> {
  const posts = await readAll();
  const post = posts.find((p) => p.id === id);
  if (!post) return null;
  post.likes = Math.max(0, post.likes + delta);
  await writeAll(posts);
  return post.likes;
}

/** Add a comment to a post and return it. Returns null if the post is gone. */
export async function addComment(
  id: string,
  input: { username: string; text: string }
): Promise<Comment | null> {
  const posts = await readAll();
  const post = posts.find((p) => p.id === id);
  if (!post) return null;
  const comment: Comment = {
    id: crypto.randomUUID(),
    username: input.username,
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  post.comments.push(comment);
  await writeAll(posts);
  return comment;
}
