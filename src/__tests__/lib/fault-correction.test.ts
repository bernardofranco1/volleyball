/**
 * Late-discovered positional faults (spec/29 F13).
 *
 * The rule this encodes: when a rotation / service-order fault is spotted some
 * rallies after it began, the points the FAULTING team scored while at fault
 * are cancelled and the opponent keeps everything they scored in the same
 * window. That asymmetry is the whole reason this is a batch of targeted UNDOs
 * rather than a REWIND — a rewind truncates the tail and would erase both
 * teams' points alike (spec/29 §Revalidation §5).
 *
 * `selectPointsToCancel` is the pure half, so it can be pinned without a
 * database; the console shows the scorer its count before they commit.
 */
import { describe, expect, it } from "vitest";
import { selectPointsToCancel } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

type P = { type: string } & Record<string, unknown>;

/** A log of rallies alternating as scripted, plus whatever extras are given. */
function log(entries: [number, P][]): EngineEvent[] {
  return entries.map(([sequence, payload]) => ({
    id: `e${sequence}`,
    sequence,
    timestamp: "2026-08-17T10:00:00.000Z",
    payload,
  })) as EngineEvent[];
}

describe("selectPointsToCancel", () => {
  const rallies = log([
    [1, { type: "SET_START", setNumber: 1 }],
    [2, { type: "RALLY_WON_A" }],
    [3, { type: "RALLY_WON_B" }], // ← fault begins here
    [4, { type: "RALLY_WON_A" }],
    [5, { type: "RALLY_WON_A" }],
    [6, { type: "RALLY_WON_B" }],
    [7, { type: "RALLY_WON_A" }],
  ]);

  it("takes only the faulting team's points, only from the fault moment", () => {
    const doomed = selectPointsToCancel(rallies, { team: "A", fromSequence: 3 });
    expect(doomed.map((e) => e.sequence)).toEqual([4, 5, 7]);
  });

  it("leaves the opponent's points alone — the reason this isn't a rewind", () => {
    const doomed = selectPointsToCancel(rallies, { team: "A", fromSequence: 3 });
    expect(doomed.every((e) => e.payload.type === "RALLY_WON_A")).toBe(true);
    // B scored at 3 and 6, inside the window, and keeps both.
    expect(doomed.map((e) => e.sequence)).not.toContain(3);
    expect(doomed.map((e) => e.sequence)).not.toContain(6);
  });

  it("never reaches back before the fault moment", () => {
    // A's point at sequence 2 predates the fault and is legitimate.
    const doomed = selectPointsToCancel(rallies, { team: "A", fromSequence: 3 });
    expect(doomed.map((e) => e.sequence)).not.toContain(2);
  });

  it("ignores points already undone, so a correction can't double-count", () => {
    const withUndo = log([
      [1, { type: "RALLY_WON_A" }],
      [2, { type: "RALLY_WON_A" }],
      [3, { type: "UNDO", targetEventId: "e2" }],
      [4, { type: "RALLY_WON_A" }],
    ]);
    const doomed = selectPointsToCancel(withUndo, { team: "A", fromSequence: 1 });
    expect(doomed.map((e) => e.sequence)).toEqual([1, 4]);
  });

  it("returns nothing when the team scored nothing in the window", () => {
    const doomed = selectPointsToCancel(rallies, { team: "B", fromSequence: 7 });
    expect(doomed).toEqual([]);
  });

  it("handles a fault discovered immediately (nothing to cancel yet)", () => {
    const doomed = selectPointsToCancel(rallies, { team: "A", fromSequence: 8 });
    expect(doomed).toEqual([]);
  });
});
