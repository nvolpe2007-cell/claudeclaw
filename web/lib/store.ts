import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// A tiny JSON-file store for the feed. It keeps the prototype runnable with
// zero external accounts. It is NOT meant for production — concurrent writes
// aren't transactional and photos are stored inline as base64. Phase 3
// replaces this whole file with Supabase (Postgres + storage bucket); the
// Post shape and the two functions below are the seam that makes that swap
// a drop-in — the API routes call `getPosts()` / `addPost()` and don't care
// what's behind them.

export interface Post {
  id: string;
  task: string;
  caption: string;
  username: string;
  /** Data URL (e.g. "data:image/jpeg;base64,...") for the proof photo. */
  photo: string;
  createdAt: string; // ISO timestamp
}

export interface NewPost {
  task: string;
  caption: string;
  username: string;
  photo: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");

async function readAll(): Promise<Post[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Post[]) : [];
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
    photo: input.photo,
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  await writeAll(posts);
  return post;
}
