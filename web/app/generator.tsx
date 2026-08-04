"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES } from "@/lib/tasks";

export default function Generator({
  initialTask,
  initialCategory,
}: {
  initialTask: string;
  initialCategory?: string;
}) {
  const [task, setTask] = useState(initialTask);
  const [category, setCategory] = useState<string | undefined>(initialCategory);
  const [filter, setFilter] = useState<string>(""); // "" = any mood
  const [loading, setLoading] = useState(false);

  async function newNudge(withFilter = filter) {
    setLoading(true);
    try {
      const qs = withFilter ? `?category=${encodeURIComponent(withFilter)}` : "";
      const res = await fetch(`/api/task/random${qs}`, { cache: "no-store" });
      const data = (await res.json()) as { task: string; category?: string };
      setTask(data.task);
      setCategory(data.category);
    } catch {
      // Keep the current task on failure.
    } finally {
      setLoading(false);
    }
  }

  function pickFilter(next: string) {
    const value = filter === next ? "" : next; // tap again to clear
    setFilter(value);
    void newNudge(value);
  }

  return (
    <section className="generator">
      <div className="mascot">✨</div>
      <p className="kicker">{category ? category : "Your nudge"}</p>
      <div className="task-card">{task}</div>

      <div className="chips">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? "chip-on" : ""}`}
            onClick={() => pickFilter(c)}
            disabled={loading}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="actions">
        <button className="btn btn-ghost" onClick={() => newNudge()} disabled={loading}>
          {loading ? "Thinking…" : "🎲 New nudge"}
        </button>
        <Link className="btn btn-primary" href={`/post?task=${encodeURIComponent(task)}`}>
          I did it — post my video
        </Link>
      </div>
    </section>
  );
}
