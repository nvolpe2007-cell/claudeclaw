import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Comment, NewPost, Post, StoreApi } from "./types";

// The zero-config local backend: a JSON file with videos inlined as base64.
// Great for running the app with no accounts; NOT for production (writes
// aren't transactional, and base64 video bloats fast). Supabase is the
// production backend — see ./supabase.ts.

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
    return [];
  }
}

async function writeAll(posts: Post[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(posts, null, 2), "utf8");
}

export const fileStore: StoreApi = {
  async getPosts() {
    const posts = await readAll();
    return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async addPost(input: NewPost) {
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
  },

  async adjustLikes(id: string, delta: 1 | -1) {
    const posts = await readAll();
    const post = posts.find((p) => p.id === id);
    if (!post) return null;
    post.likes = Math.max(0, post.likes + delta);
    await writeAll(posts);
    return post.likes;
  },

  async addComment(id: string, input: { username: string; text: string }) {
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
  },
};
