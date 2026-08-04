"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MAX_BYTES = 30 * 1024 * 1024; // ~30MB source video cap (prototype)

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function PostForm({ task }: { task: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [caption, setCaption] = useState("");
  const [video, setVideo] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("That's not a video — record or pick a short clip.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That clip is a bit large — keep it under 30MB (try ~10 seconds).");
      return;
    }
    try {
      setVideo(await fileToDataUrl(file));
    } catch {
      setError("Couldn't read that video. Try another one.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim()) return setError("Add a username so people know who nailed it.");
    if (!video) return setError("Add a proof video.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, username, caption, video }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Something went wrong posting your nudge.");
      }
      router.push("/feed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div>
        <p className="page-title">Post your proof</p>
        <p className="page-sub">You did the nudge — record it and drop it in the reel.</p>
        <span className="task-chip">✨ {task}</span>
      </div>

      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          value={username}
          maxLength={30}
          placeholder="e.g. brave_bean"
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="video">Proof video</label>
        <input
          id="video"
          type="file"
          accept="video/*"
          capture="environment"
          onChange={onPickVideo}
        />
        <p className="hint">On a phone this opens the camera. Keep it short (~10s), max 30MB.</p>
        {video && (
          <video className="preview-video" src={video} controls playsInline muted />
        )}
      </div>

      <div className="field">
        <label htmlFor="caption">Caption</label>
        <textarea
          id="caption"
          value={caption}
          maxLength={280}
          placeholder="How did it go?"
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Posting…" : "Share to reel"}
        </button>
      </div>
    </form>
  );
}
