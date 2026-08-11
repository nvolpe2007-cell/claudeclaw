import { NextResponse } from "next/server";
import { getPosts, addPost } from "@/lib/store";

export const runtime = "nodejs"; // uses the filesystem store
export const dynamic = "force-dynamic";

// GET /api/posts → Post[] (newest first)
export async function GET() {
  const posts = await getPosts();
  return NextResponse.json(posts);
}

// POST /api/posts → creates a completed-nudge post.
// Body: { task, caption, username, photo (data URL) }
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { task, caption, username, video } = (body ?? {}) as Record<string, unknown>;

  if (typeof task !== "string" || task.trim() === "") {
    return NextResponse.json({ error: "A task is required." }, { status: 400 });
  }
  if (typeof username !== "string" || username.trim() === "") {
    return NextResponse.json({ error: "A username is required." }, { status: 400 });
  }
  if (typeof video !== "string" || !video.startsWith("data:video/")) {
    return NextResponse.json({ error: "A proof video is required." }, { status: 400 });
  }

  const post = await addPost({
    task: task.trim(),
    caption: typeof caption === "string" ? caption.trim() : "",
    username: username.trim(),
    video,
  });

  return NextResponse.json(post, { status: 201 });
}
