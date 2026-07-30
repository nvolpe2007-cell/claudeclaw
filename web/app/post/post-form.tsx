"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MAX_BYTES = 6 * 1024 * 1024; // ~6MB source image cap

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
  const [photo, setPhoto] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That photo is a bit large — please pick one under 6MB.");
      return;
    }
    try {
      setPhoto(await fileToDataUrl(file));
    } catch {
      setError("Couldn't read that image. Try another one.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim()) return setError("Add a username so people know who nailed it.");
    if (!photo) return setError("Add a proof photo.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, username, caption, photo }),
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
        <p className="page-sub">You did the nudge — show it off.</p>
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
        <label htmlFor="photo">Proof photo</label>
        <input id="photo" type="file" accept="image/*" capture="environment" onChange={onPickPhoto} />
        <p className="hint">On a phone this opens the camera. Max 6MB.</p>
        {photo && <img className="preview-img" src={photo} alt="Preview of your proof" />}
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
          {submitting ? "Posting…" : "Share to feed"}
        </button>
      </div>
    </form>
  );
}
