// The storage contract. Both backends — the local file store and Supabase —
// implement this identical interface, so the API routes and UI never change
// when you swap one for the other. Picking a backend happens in ./index.ts
// based on whether Supabase env vars are present.

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
  /**
   * Playable video source. In the file store this is a base64 data URL; with
   * Supabase it's a public URL in the storage bucket. `<video src>` accepts
   * either, so nothing downstream cares which backend produced it.
   */
  video: string;
  likes: number;
  comments: Comment[];
  createdAt: string; // ISO timestamp
}

export interface NewPost {
  task: string;
  caption: string;
  username: string;
  /** Always a base64 data URL from the client; the backend stores it as it sees fit. */
  video: string;
}

export interface StoreApi {
  /** Newest-first list of completed nudges, each with its comments. */
  getPosts(): Promise<Post[]>;
  /** Create a post and return the stored record. */
  addPost(input: NewPost): Promise<Post>;
  /** Move a post's like counter by +1/-1 (clamped at 0). Null if not found. */
  adjustLikes(id: string, delta: 1 | -1): Promise<number | null>;
  /** Add a comment and return it. Null if the post is gone. */
  addComment(id: string, input: { username: string; text: string }): Promise<Comment | null>;
}

/** Split a base64 data URL into its mime type and raw bytes. */
export function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}
