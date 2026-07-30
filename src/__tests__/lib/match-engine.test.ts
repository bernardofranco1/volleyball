import { describe, expect, it } from "vitest";
import { shouldSnapshot } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

const TS = "2026-07-01T10:00:00.000Z";

describe("shouldSnapshot (snapshot cache write policy)", () => {
  const live = (seq: number) => ({ lastSequence: seq, status: "LIVE" as const });
  const ev = (type: string): EngineEvent =>
    ({ id: "x", sequence: 1, timestamp: TS, payload: { type } }) as EngineEvent;

  it("always snapshots when none exists", () => {
    expect(shouldSnapshot(false, 0, live(1), [ev("RALLY_WON_A")])).toBe(true);
  });
  it("skips within the interval, writes at the boundary", () => {
    expect(shouldSnapshot(true, 10, live(12), [ev("RALLY_WON_A")])).toBe(false);
    expect(shouldSnapshot(true, 10, live(15), [ev("RALLY_WON_A")])).toBe(true);
  });
  it("writes when the match leaves LIVE or on system auto-emits", () => {
    expect(
      shouldSnapshot(true, 10, { lastSequence: 11, status: "FINISHED" }, [ev("RALLY_WON_A")]),
    ).toBe(true);
    expect(shouldSnapshot(true, 10, live(11), [ev("RALLY_WON_A"), ev("SET_END")])).toBe(true);
  });
});
