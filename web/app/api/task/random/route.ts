import { NextResponse } from "next/server";
import { randomTask } from "@/lib/tasks";

// GET /api/task/random → { task: string }
//
// This is the endpoint the iOS widget will call in phase 3 (replacing its
// bundled Tasks.random()). Keeping the contract tiny — one string — means
// the widget change is a one-liner.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ task: randomTask() });
}
