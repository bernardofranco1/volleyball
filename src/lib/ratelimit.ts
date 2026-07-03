// Rate limiting (Phase 11). Uses Upstash Redis when configured
// (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for a cross-instance
// sliding window; otherwise falls back to a per-instance in-memory window so the
// limiter still works in dev/single-instance. Same `rateLimit(key)` signature
// either way. Fails OPEN on a limiter error — availability over strict limiting
// for a live-scoring app.
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { captureError } from "@/lib/observability";

const WINDOW_MS = 10_000;
const MAX_HITS = 30; // per key per window

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstash =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(MAX_HITS, "10 s"),
        prefix: "vb_rl",
        analytics: false,
      })
    : null;

// A stricter, fixed sliding window for auth-sensitive actions (login, PIN
// verification) that must be genuinely un-brute-forceable. The generic
// `rateLimit` Upstash path is fixed at 30/10s, which is far too loose for these;
// use `rateLimitAuth` for those keys instead.
const AUTH_MAX = 5;
const authUpstash =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(AUTH_MAX, "60 s"),
        prefix: "vb_rl_auth",
        analytics: false,
      })
    : null;

/** Strict 5-per-60s limiter for auth-sensitive keys (login, scorer PIN). */
export async function rateLimitAuth(key: string): Promise<boolean> {
  if (authUpstash) {
    try {
      const { success } = await authUpstash.limit(key);
      return success;
    } catch (err) {
      captureError(err, { scope: "ratelimit-auth", key });
      return true;
    }
  }
  return memoryLimit(`auth:${key}`, AUTH_MAX, 60_000);
}

// ── in-memory fallback ────────────────────────────────────────────────────────
const buckets = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

/** True if allowed, false if `key` is over its limit. (`max`/`windowMs` apply to
 *  the in-memory fallback; the Upstash window is fixed at the configured rate.) */
export async function rateLimit(
  key: string,
  max = MAX_HITS,
  windowMs = WINDOW_MS,
): Promise<boolean> {
  if (upstash) {
    try {
      const { success } = await upstash.limit(key);
      return success;
    } catch (err) {
      // Fail open — never block scoring on a limiter outage — but make the
      // outage visible instead of silently running unlimited.
      captureError(err, { scope: "ratelimit", key });
      return true;
    }
  }
  return memoryLimit(key, max, windowMs);
}
