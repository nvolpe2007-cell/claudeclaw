import Link from "next/link";
import { getPosts } from "@/lib/store";
import Reel from "./reel";

// Always render the latest posts from the store.
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const posts = await getPosts();

  if (posts.length === 0) {
    return (
      <div className="empty">
        <p style={{ fontSize: "2.5rem", margin: 0 }}>🎬</p>
        <p>No nudges yet. Be the first to post a video!</p>
        <Link className="btn btn-primary" href="/">
          Get a nudge
        </Link>
      </div>
    );
  }

  return <Reel posts={posts} />;
}
