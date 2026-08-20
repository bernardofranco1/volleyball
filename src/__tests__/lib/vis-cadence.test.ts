/**
 * The VIS poll cadence (spec/37) — the one rule the browser timer, the server
 * store's TTL and the CDN's s-maxage all read, so none of them can quietly add
 * its own latency on top of the others.
 */

import { describe, expect, it } from "vitest";
import { BREAK_MS, FINISHED_MS, LIVE_MS, UPCOMING_MS, cdnMaxAgeSeconds, pollIntervalMs, boardCacheControl, VS_IN_RALLY_MS } from "@/lib/vis-live/cadence";

const state = (
  status: "UPCOMING" | "LIVE" | "FINISHED",
  inSetBreak: boolean,
  pollDelaySeconds = 20,
) => ({ status, inSetBreak, pollDelaySeconds });

describe("poll cadence", () => {
  it("reads once a second while a set is being played", () => {
    expect(pollIntervalMs(state("LIVE", false))).toBe(LIVE_MS);
  });

  it("ignores the feed's advisory delay ONLY during play", () => {
    // FIVB authorised one request per second per match for live play. Every
    // other state stays at or below the feed's own suggested cadence.
    expect(pollIntervalMs(state("LIVE", false, 60))).toBe(LIVE_MS);
    expect(pollIntervalMs(state("LIVE", true, 60))).toBe(60_000);
    expect(pollIntervalMs(state("UPCOMING", false, 60))).toBe(60_000);
  });

  it("backs off between sets, before the match and after it", () => {
    expect(pollIntervalMs(state("LIVE", true, 0))).toBe(BREAK_MS);
    expect(pollIntervalMs(state("UPCOMING", false, 0))).toBe(UPCOMING_MS);
    expect(pollIntervalMs(state("FINISHED", false, 0))).toBe(FINISHED_MS);
  });

  it("never polls faster in a break than during play", () => {
    const live = pollIntervalMs(state("LIVE", false));
    for (const s of [state("LIVE", true), state("UPCOMING", false), state("FINISHED", false)]) {
      expect(pollIntervalMs(s)).toBeGreaterThan(live);
    }
  });

  it("keeps the CDN window at or under the poll interval, and never zero", () => {
    expect(cdnMaxAgeSeconds(LIVE_MS)).toBe(1);
    expect(cdnMaxAgeSeconds(500)).toBe(1);
    expect(cdnMaxAgeSeconds(BREAK_MS)).toBe(5);
    expect(cdnMaxAgeSeconds(FINISHED_MS)).toBe(30);
  });
});

describe("what the CDN may serve while a set is being played", () => {
  const live = { status: "LIVE" as const, inSetBreak: false };
  const breakTime = { status: "LIVE" as const, inSetBreak: true };
  const finished = { status: "FINISHED" as const, inSetBreak: false };

  it("allows no stale window during live play", () => {
    // Measured on a live board: the edge answered STALE on four reads in six,
    // and s-maxage=1 + stale-while-revalidate=2 entitles it to hand a venue
    // screen a score three seconds old. That was the biggest single slice of
    // the delay from a point being scored to the number changing in the hall.
    expect(boardCacheControl(live, 1_000)).toBe(
      "public, s-maxage=1, stale-while-revalidate=0",
    );
  });

  it("keeps the stale window when nothing is moving", () => {
    // Between sets, before the whistle and after the match, a stale response is
    // free — nothing has changed for it to be wrong about.
    expect(boardCacheControl(breakTime, 5_000)).toBe(
      "public, s-maxage=5, stale-while-revalidate=10",
    );
    expect(boardCacheControl(finished, 30_000)).toBe(
      "public, s-maxage=30, stale-while-revalidate=60",
    );
  });

  it("asks more often while a VolleyStation rally is in progress", () => {
    // VolleyStation says `in_rally` outright, so the board can ask more often
    // for exactly the seconds a point is imminent. VIS has no such signal, and
    // its one-request-per-second agreement is not ours to change.
    expect(VS_IN_RALLY_MS).toBeLessThan(LIVE_MS);
    expect(VS_IN_RALLY_MS).toBeGreaterThanOrEqual(250);
  });
});
