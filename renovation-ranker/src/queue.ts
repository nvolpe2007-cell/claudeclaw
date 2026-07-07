/**
 * Phase 2 concurrency primitives: a bounded worker pool and a minimum-
 * interval rate limiter. No external queue infra — resume-on-rerun falls out
 * of the pipeline's capture-date cache (already-scanned addresses skip).
 */

/** Run worker over items with at most `concurrency` in flight; results keep
 * input order. Worker errors propagate (pipeline workers catch their own). */
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

/** Serializes acquire() calls so consecutive grants are at least
 * `minIntervalMs` apart — keeps Google calls under QPS limits even when the
 * scan pool runs several addresses concurrently. */
export class RateLimiter {
  private nextFree = 0;
  constructor(private minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextFree);
    this.nextFree = at + this.minIntervalMs;
    if (at > now) await Bun.sleep(at - now);
  }
}
