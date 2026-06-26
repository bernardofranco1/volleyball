// Lightweight fixed-window rate limiter (spec/14 §C2 stopgap).
//
// PRODUCTION: replace with a shared store (Upstash @upstash/ratelimit + Redis)
// so limits hold across serverless instances. This in-memory version is
// per-instance only — adequate for single-instance/dev and as a backstop, NOT a
// real cross-instance guarantee. Keep the same `rateLimit(key)` signature so the
// swap is a one-file change.

const WINDOW_MS = 10_000;
const MAX_HITS = 30; // per key per window

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true if the request is allowed, false if the key is over its limit. */
export async function rateLimit(
  key: string,
  max = MAX_HITS,
  windowMs = WINDOW_MS,
): Promise<boolean> {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}
