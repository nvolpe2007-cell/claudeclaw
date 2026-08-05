import { NextResponse } from "next/server";
import { BACKEND, getPosts } from "@/lib/store";

// GET /api/health → which backend is live and whether it's reachable.
// After setting your Supabase env vars, hit this to confirm the connection:
//   curl http://localhost:3000/api/health
// Expected once connected: { "ok": true, "backend": "supabase", "posts": 0 }
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const posts = await getPosts();
    return NextResponse.json({ ok: true, backend: BACKEND, posts: posts.length });
  } catch (error) {
    // Most likely: env vars set but the schema hasn't been run, or a bad key.
    return NextResponse.json(
      {
        ok: false,
        backend: BACKEND,
        error: error instanceof Error ? error.message : "Unknown error",
        hint: "If backend is 'supabase', run supabase/schema.sql and re-check your keys in .env.local.",
      },
      { status: 500 }
    );
  }
}
