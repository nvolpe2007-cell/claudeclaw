import { NextResponse } from "next/server";
import { adjustLikes } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/posts/:id/like  body: { op: "like" | "unlike" }
// → { likes: number }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const op = (body as { op?: string }).op;
  const delta = op === "unlike" ? -1 : 1;

  const likes = await adjustLikes(params.id, delta);
  if (likes === null) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  return NextResponse.json({ likes });
}
