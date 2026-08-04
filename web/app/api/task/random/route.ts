import { NextResponse } from "next/server";
import { randomTask, categoryOf } from "@/lib/tasks";

// GET /api/task/random           → { task, category }
// GET /api/task/random?category=Get%20Active → a nudge from that mood
//
// This is the endpoint the iOS widget will call in phase 3 (replacing its
// bundled Tasks.random()). Keeping the contract tiny means the widget change
// is a one-liner.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category") ?? undefined;
  const task = randomTask(category);
  return NextResponse.json({ task, category: categoryOf(task) });
}
