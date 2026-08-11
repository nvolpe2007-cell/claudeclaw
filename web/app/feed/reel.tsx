"use client";

import { useEffect, useRef, useState } from "react";
import { categoryOf } from "@/lib/tasks";

export interface ReelComment {
  id: string;
  username: string;
  text: string;
  createdAt: string;
}

export interface ReelPost {
  id: string;
  task: string;
  caption: string;
  username: string;
  video: string;
  likes: number;
  comments: ReelComment[];
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const LIKED_KEY = "nudge_liked";
const NAME_KEY = "nudge_username";

export default function Reel({ posts }: { posts: ReelPost[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ReelPost[]>(posts);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  // Load this browser's liked set once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIKED_KEY);
      if (raw) setLiked(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  // Autoplay whichever reel is on screen; pause the rest.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { root, threshold: [0, 0.6, 1] }
    );
    videos.forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, [items.length]);

  function persistLiked(next: Set<string>) {
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  function bumpLikes(id: string, delta: number) {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, likes: Math.max(0, p.likes + delta) } : p))
    );
  }

  async function toggleLike(id: string) {
    const isLiked = liked.has(id);
    const op = isLiked ? "unlike" : "like";

    // Optimistic update.
    const nextLiked = new Set(liked);
    if (isLiked) nextLiked.delete(id);
    else nextLiked.add(id);
    setLiked(nextLiked);
    persistLiked(nextLiked);
    bumpLikes(id, isLiked ? -1 : 1);

    try {
      const res = await fetch(`/api/posts/${id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { likes: number };
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, likes: data.likes } : p)));
    } catch {
      // Revert on failure.
      setLiked(liked);
      persistLiked(liked);
      bumpLikes(id, isLiked ? 1 : -1);
    }
  }

  function toCommentAdded(id: string, comment: ReelComment) {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, comments: [...p.comments, comment] } : p))
    );
  }

  const openPost = items.find((p) => p.id === openId) ?? null;

  return (
    <>
      <div className="reel" ref={containerRef}>
        {items.map((post) => {
          const isLiked = liked.has(post.id);
          return (
            <section className="reel-item" key={post.id}>
              <video
                className="reel-video"
                src={post.video}
                loop
                muted
                playsInline
                preload="metadata"
                onClick={(e) => {
                  const v = e.currentTarget;
                  v.muted = !v.muted;
                  if (v.paused) v.play().catch(() => {});
                }}
              />

              <div className="reel-overlay">
                <div className="reel-top">
                  <span className="task-chip">✨ {post.task}</span>
                </div>
                <div className="reel-bottom">
                  <div className="reel-meta">
                    <span className="reel-user">@{post.username}</span>
                    <span className="reel-sub">
                      {categoryOf(post.task) ? `${categoryOf(post.task)} · ` : ""}
                      {timeAgo(post.createdAt)}
                    </span>
                  </div>
                  {post.caption && <p className="reel-caption">{post.caption}</p>}
                  <p className="reel-hint">Tap the video for sound</p>
                </div>
              </div>

              {/* Right-side action rail */}
              <div className="reel-rail">
                <button
                  className={`rail-btn ${isLiked ? "liked" : ""}`}
                  onClick={() => toggleLike(post.id)}
                  aria-label={isLiked ? "Unlike" : "Like"}
                >
                  <span className="rail-icon">{isLiked ? "❤️" : "🤍"}</span>
                  <span className="rail-count">{post.likes}</span>
                </button>
                <button
                  className="rail-btn"
                  onClick={() => setOpenId(post.id)}
                  aria-label="Comments"
                >
                  <span className="rail-icon">💬</span>
                  <span className="rail-count">{post.comments.length}</span>
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {openPost && (
        <CommentsSheet
          post={openPost}
          onClose={() => setOpenId(null)}
          onAdded={(c) => toCommentAdded(openPost.id, c)}
        />
      )}
    </>
  );
}

function CommentsSheet({
  post,
  onClose,
  onAdded,
}: {
  post: ReelPost;
  onClose: () => void;
  onAdded: (c: ReelComment) => void;
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Add your name first.");
    if (!text.trim()) return setError("Say something!");

    setSending(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name.trim(), text: text.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't post that comment.");
      }
      const comment = (await res.json()) as ReelComment;
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* ignore */
      }
      onAdded(comment);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>{post.comments.length} comments</strong>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sheet-list">
          {post.comments.length === 0 && (
            <p className="sheet-empty">No comments yet — be the first.</p>
          )}
          {post.comments.map((c) => (
            <div className="comment" key={c.id}>
              <span className="comment-user">@{c.username}</span>
              <span className="comment-text">{c.text}</span>
            </div>
          ))}
        </div>

        <form className="sheet-form" onSubmit={submit}>
          <input
            className="sheet-name"
            type="text"
            value={name}
            maxLength={30}
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="sheet-row">
            <input
              className="sheet-input"
              type="text"
              value={text}
              maxLength={280}
              placeholder="Add a comment…"
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={sending}>
              {sending ? "…" : "Post"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
