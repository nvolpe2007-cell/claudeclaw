import { NextResponse } from "next/server";
import { addComment } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/posts/:id/comments  body: { username, text }
// → the created Comment
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { username, text } = (body ?? {}) as Record<string, unknown>;

  if (typeof username !== "string" || username.trim() === "") {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json({ error: "Say something!" }, { status: 400 });
  }

  const comment = await addComment(params.id, {
    username: username.trim().slice(0, 30),
    text: text.trim().slice(0, 280),
  });

  if (!comment) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  return NextResponse.json(comment, { status: 201 });
}
