import Link from "next/link";
import { getPosts } from "@/lib/store";
import { categoryOf } from "@/lib/tasks";

// Always render the latest posts from the store.
export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function FeedPage() {
  const posts = await getPosts();

  if (posts.length === 0) {
    return (
      <div className="empty">
        <p style={{ fontSize: "2.5rem", margin: 0 }}>🌱</p>
        <p>No nudges yet. Be the first!</p>
        <Link className="btn btn-primary" href="/">
          Get a nudge
        </Link>
      </div>
    );
  }

  return (
    <div className="feed">
      {posts.map((post) => (
        <article className="post" key={post.id}>
          <div className="post-head">
            <span className="post-user">@{post.username}</span>
            <span className="post-time">
              {categoryOf(post.task) ? `${categoryOf(post.task)} · ` : ""}
              {timeAgo(post.createdAt)}
            </span>
          </div>
          <div className="post-task">
            <span className="task-chip">✨ {post.task}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="post-photo" src={post.photo} alt={`Proof by ${post.username}`} />
          {post.caption && <p className="post-caption">{post.caption}</p>}
        </article>
      ))}
    </div>
  );
}
