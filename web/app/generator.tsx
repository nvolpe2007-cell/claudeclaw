"use client";

import Link from "next/link";
import { useState } from "react";

export default function Generator({ initialTask }: { initialTask: string }) {
  const [task, setTask] = useState(initialTask);
  const [loading, setLoading] = useState(false);

  async function newNudge() {
    setLoading(true);
    try {
      const res = await fetch("/api/task/random", { cache: "no-store" });
      const data = (await res.json()) as { task: string };
      setTask(data.task);
    } catch {
      // Keep the current task on failure.
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="generator">
      <div className="mascot">✨</div>
      <p className="kicker">Your nudge</p>
      <div className="task-card">{task}</div>
      <div className="actions">
        <button className="btn btn-ghost" onClick={newNudge} disabled={loading}>
          {loading ? "Thinking…" : "🎲 New nudge"}
        </button>
        <Link className="btn btn-primary" href={`/post?task=${encodeURIComponent(task)}`}>
          I did it — post proof
        </Link>
      </div>
    </section>
  );
}
