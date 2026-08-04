"use client";

import { useEffect, useRef } from "react";
import { categoryOf } from "@/lib/tasks";

export interface ReelPost {
  id: string;
  task: string;
  caption: string;
  username: string;
  video: string;
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

export default function Reel({ posts }: { posts: ReelPost[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Autoplay whichever reel is on screen; pause the rest. Muted so autoplay
  // is allowed — tapping a clip toggles its sound.
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
  }, [posts]);

  function toggleSound(e: React.MouseEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    video.muted = !video.muted;
    if (video.paused) video.play().catch(() => {});
  }

  return (
    <div className="reel" ref={containerRef}>
      {posts.map((post) => (
        <section className="reel-item" key={post.id}>
          <video
            className="reel-video"
            src={post.video}
            loop
            muted
            playsInline
            preload="metadata"
            onClick={toggleSound}
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
        </section>
      ))}
    </div>
  );
}
