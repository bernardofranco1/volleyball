// The public-read limiter (spec/24 §9.5 F3). Spectators at a venue all egress
// from one NAT IP and share the `state:<ip>:<match>` bucket, so the generic
// 30-per-10s ceiling 429'd real viewers once about ten phones were watching.
// This guards the headroom and, importantly, that it is a *separate* limiter —
// the generic one must stay strict for write paths.
import { describe, expect, it } from "vitest";
import { rateLimit, rateLimitPublicRead } from "@/lib/ratelimit";

describe("rateLimitPublicRead", () => {
  it("allows far more than the generic limiter in one window", async () => {
    const key = `state:198.51.100.1:match_${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (await rateLimitPublicRead(key)) allowed += 1;
    // 200 concurrent-ish polls from one venue must all get through.
    expect(allowed).toBe(200);
  });

  it("still has a ceiling — it is a limiter, not an exemption", async () => {
    const key = `state:198.51.100.2:match_${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 400; i++) if (await rateLimitPublicRead(key)) allowed += 1;
    expect(allowed).toBeLessThan(400);
  });

  it("does not loosen the generic limiter, which write paths rely on", async () => {
    const key = `events:198.51.100.3:match_${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (await rateLimit(key)) allowed += 1;
    expect(allowed).toBeLessThanOrEqual(30);
  });

  it("keeps separate buckets per key, so one venue cannot starve another", async () => {
    const a = `state:198.51.100.4:match_a`;
    const b = `state:198.51.100.5:match_b`;
    for (let i = 0; i < 300; i++) await rateLimitPublicRead(a);
    expect(await rateLimitPublicRead(b)).toBe(true);
  });
});
