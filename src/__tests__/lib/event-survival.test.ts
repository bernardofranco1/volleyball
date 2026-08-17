/**
 * Which events a correction cancelled (spec/30 Phase D).
 *
 * Audit views — the scorer's log overlay, the event-log PDFs — keep showing
 * cancelled events with their as-recorded scores, because the log is
 * append-only and recording what was later taken back is the point of it.
 * What they were missing is the MARKING: after an F13 fault correction several
 * mid-set rallies are cancelled at once, and unmarked they read as a score
 * that jumps around for no visible reason.
 *
 * This is the exact complement of `survivingEvents`, so the two must never
 * disagree — a row shown as live in one view and cancelled in another would be
 * worse than no marking at all.
 */
import { describe, expect, it } from "vitest";
import { cancelledEventIds } from "@/lib/event-survival";
import { survivingEvents } from "@/lib/scoresheet/official-data";
import type { ReportEvent } from "@/lib/match-report";

function log(entries: [string, Record<string, unknown>][]): ReportEvent[] {
  return entries.map(([type, payload], i) => ({
    id: `e${i + 1}`,
    sequence: i + 1,
    eventType: type,
    setNumber: 1,
    scoreAfterA: null,
    scoreAfterB: null,
    timestamp: new Date("2026-08-17T10:00:00.000Z"),
    actor: "SCORER",
    notes: null,
    payload: { type, ...payload },
  }));
}

describe("cancelledEventIds", () => {
  it("reports the target of an UNDO", () => {
    const evs = log([
      ["RALLY_WON_A", {}],
      ["RALLY_WON_B", {}],
      ["UNDO", { targetEventId: "e2" }],
    ]);
    expect([...cancelledEventIds(evs)]).toEqual(["e2"]);
  });

  it("reports everything a REWIND truncated", () => {
    const evs = log([
      ["RALLY_WON_A", {}],
      ["RALLY_WON_B", {}],
      ["RALLY_WON_A", {}],
      ["REWIND", { toSequence: 1 }],
    ]);
    expect([...cancelledEventIds(evs)].sort()).toEqual(["e2", "e3"]);
  });

  it("reports a scattered mid-set correction, not a contiguous tail", () => {
    // The F13 shape: only the faulting team's points go, the opponent's
    // point between them stays. A tail-truncation model cannot express this.
    const evs = log([
      ["RALLY_WON_A", {}],
      ["RALLY_WON_A", {}],
      ["RALLY_WON_B", {}],
      ["RALLY_WON_A", {}],
      ["UNDO", { targetEventId: "e2" }],
      ["UNDO", { targetEventId: "e4" }],
    ]);
    const gone = cancelledEventIds(evs);
    expect([...gone].sort()).toEqual(["e2", "e4"]);
    expect(gone.has("e3")).toBe(false);
  });

  it("never marks the control events themselves", () => {
    // They are the RECORD of the cancellation — striking them would hide the
    // explanation for the rows that are struck.
    const evs = log([
      ["RALLY_WON_A", {}],
      ["UNDO", { targetEventId: "e1" }],
    ]);
    expect(cancelledEventIds(evs).has("e2")).toBe(false);
  });

  it("ignores an UNDO whose target is already gone", () => {
    const evs = log([
      ["RALLY_WON_A", {}],
      ["UNDO", { targetEventId: "e1" }],
      ["UNDO", { targetEventId: "e1" }],
    ]);
    expect([...cancelledEventIds(evs)]).toEqual(["e1"]);
  });

  it("is empty for a clean log", () => {
    expect(cancelledEventIds(log([["RALLY_WON_A", {}]])).size).toBe(0);
  });
});

describe("agreement with survivingEvents", () => {
  const cases: [string, ReportEvent[]][] = [
    [
      "mid-set correction",
      log([
        ["RALLY_WON_A", {}],
        ["RALLY_WON_A", {}],
        ["RALLY_WON_B", {}],
        ["RALLY_WON_A", {}],
        ["UNDO", { targetEventId: "e2" }],
        ["UNDO", { targetEventId: "e4" }],
      ]),
    ],
    [
      "rewind",
      log([
        ["RALLY_WON_A", {}],
        ["RALLY_WON_B", {}],
        ["REWIND", { toSequence: 1 }],
      ]),
    ],
    [
      "re-scored after a rewind",
      log([
        ["RALLY_WON_A", {}],
        ["RALLY_WON_B", {}],
        ["REWIND", { toSequence: 1 }],
        ["RALLY_WON_B", {}],
      ]),
    ],
  ];

  for (const [name, evs] of cases) {
    it(`partitions the log exactly, with no overlap — ${name}`, () => {
      const gone = cancelledEventIds(evs);
      const kept = new Set(survivingEvents(evs).map((e) => e.id));
      // Nothing may be both live and cancelled.
      for (const id of gone) expect(kept.has(id)).toBe(false);
      // Every non-control event is one or the other: an event that vanished
      // from BOTH views would be silently missing from the record.
      const controls = new Set(
        evs.filter((e) => e.eventType === "UNDO" || e.eventType === "REWIND").map((e) => e.id),
      );
      for (const e of evs) {
        if (controls.has(e.id)) continue;
        expect(gone.has(e.id) || kept.has(e.id)).toBe(true);
      }
    });
  }
});
