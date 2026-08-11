// Hot-path guards for the /state polling contract (spec/24 §9.5 F1/F2/F7).
//
// The public boards and team tablets poll this endpoint on a backstop timer. The
// `?since=` probe answering 204 off one indexed MAX(), and the CDN micro-cache
// applying to probes ONLY, are what make that affordable at spectator scale — and
// both are silent when they regress: a board that has stopped sending `since`
// still works, it just costs a snapshot load + full serialization every tick,
// and a micro-cache leaking onto the broadcast-triggered refetch would hand a
// board pre-point state that its monotonic guard discards, leaving it visibly
// stale until the next tick. Hence explicit tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardFontStack } from "@/lib/board-theme";

const engine = vi.hoisted(() => ({
  latest: 0,
  loadCalls: 0,
  latestCalls: 0,
}));

vi.mock("@/lib/match-engine", () => ({
  MatchNotFoundError: class MatchNotFoundError extends Error {},
  UnsupportedDisciplineError: class UnsupportedDisciplineError extends Error {},
  latestSequence: async () => {
    engine.latestCalls += 1;
    return engine.latest;
  },
  loadMatchState: async () => {
    engine.loadCalls += 1;
    return { state: { lastSequence: engine.latest }, config: { maxSubsPerSet: 6 } };
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  rateLimitPublicRead: async () => true,
}));

const { GET } = await import("@/app/api/matches/[id]/state/route");

function req(url: string) {
  // The route reads req.nextUrl.searchParams and req.headers only.
  const u = new URL(url);
  return {
    nextUrl: u,
    headers: new Headers({ "x-forwarded-for": "203.0.113.7" }),
  } as unknown as Parameters<typeof GET>[0];
}
const ctx = { params: Promise.resolve({ id: "match_1" }) };

beforeEach(() => {
  engine.latest = 105;
  engine.loadCalls = 0;
  engine.latestCalls = 0;
});

describe("/state probe fast path (F1)", () => {
  it("answers 204 with no body when the caller is already current", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=105"), ctx);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    // The whole point: no snapshot load, just the indexed MAX().
    expect(engine.loadCalls).toBe(0);
    expect(engine.latestCalls).toBe(1);
  });

  it("returns full state when the match has moved past `since`", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=99"), ctx);
    expect(res.status).toBe(200);
    expect(engine.loadCalls).toBe(1);
  });

  it("a request with no `since` always loads state (mount / broadcast refetch)", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state"), ctx);
    expect(res.status).toBe(200);
    expect(engine.loadCalls).toBe(1);
    // Must not spend the extra round trip when there is nothing to compare to.
    expect(engine.latestCalls).toBe(0);
  });

  it("ignores a non-numeric `since` rather than 204-ing on garbage", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=abc"), ctx);
    expect(res.status).toBe(200);
  });
});

describe("/state CDN micro-cache is probe-only (F2)", () => {
  it("caches the 204 probe briefly", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=105"), ctx);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=1");
  });

  it("caches a probe that returns fresh state", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=99"), ctx);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=1");
  });

  it("NEVER caches a no-`since` read — that is the broadcast-triggered refetch", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state"), ctx);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not advertise stale-while-revalidate (would widen board lag)", async () => {
    const res = await GET(req("http://x/api/matches/match_1/state?since=105"), ctx);
    expect(res.headers.get("cache-control")).not.toContain("stale-while-revalidate");
  });
});

describe("board font stacks resolve to self-hosted variables (F7)", () => {
  it("defaults to Saira Condensed", () => {
    expect(boardFontStack()).toContain("var(--font-saira-condensed)");
  });

  it("honours a competition's stored family name", () => {
    expect(boardFontStack("Anton").startsWith("var(--font-anton)")).toBe(true);
  });

  it("falls back to the default for an unknown stored name", () => {
    expect(boardFontStack("Comic Sans").startsWith("var(--font-saira-condensed)")).toBe(
      true,
    );
  });

  it("never emits a bare family name — those no longer resolve under next/font", () => {
    // A literal 'Saira Condensed' in the stack is the bug that made boards
    // silently fall back to the app font.
    expect(boardFontStack("Saira Condensed")).not.toMatch(/['"]Saira Condensed['"]/);
  });

  it("always ends in a system fallback so text renders if a face fails", () => {
    expect(boardFontStack("Archivo")).toContain("system-ui");
  });

  it("does not repeat the chosen family in its own fallback list", () => {
    const stack = boardFontStack("Barlow Condensed");
    const hits = stack.match(/var\(--font-barlow-condensed\)/g) ?? [];
    expect(hits).toHaveLength(1);
  });
});
