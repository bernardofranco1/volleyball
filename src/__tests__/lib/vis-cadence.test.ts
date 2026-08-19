/**
 * The VIS poll cadence (spec/37) — the one rule the browser timer, the server
 * store's TTL and the CDN's s-maxage all read, so none of them can quietly add
 * its own latency on top of the others.
 */

import { describe, expect, it } from "vitest";
import {
  BREAK_MS,
  FINISHED_MS,
  LIVE_MS,
  UPCOMING_MS,
  cdnMaxAgeSeconds,
  pollIntervalMs,
} from "@/lib/vis-live/cadence";

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
