/**
 * Offline queue persistence rules (spec/29 Phase 7, spec/30 Phase E).
 *
 * These tests exercise the REAL decision functions the provider calls —
 * `decideQueueRestore` and `describeLegacyQueue` from @/lib/offline-queue.
 * Earlier versions of this file carried private copies of the logic and
 * asserted against those, which meant the provider could drift while the
 * tests stayed green (spec/31 test-suite audit). The extraction closed that:
 * a rule change now either fails here or changes behaviour, never neither.
 *
 * The two failure modes both land on the official record:
 *
 * 1. PER TAB. The queue lived in localStorage, shared across tabs with no
 *    coordination — two consoles on one match double-scored every queued
 *    point. sessionStorage is per tab and still survives reload/navigation.
 * 2. AGED OUT. A queue restored hours later would replay rallies into a match
 *    that has since been scored, corrected or signed. Old queues are dropped
 *    with a visible message, never silently flushed.
 */
import { describe, expect, it } from "vitest";
import {
  QUEUE_MAX_AGE_MS,
  decideQueueRestore,
  describeLegacyQueue,
} from "@/lib/offline-queue";

const now = Date.UTC(2026, 7, 17, 20, 0, 0);
const stamped = (agoMs: number, items: { type: string }[]) =>
  JSON.stringify({ savedAt: now - agoMs, items });

describe("queue age-out", () => {
  it("flushes a queue from moments ago", () => {
    const r = decideQueueRestore(stamped(30_000, [{ type: "RALLY_WON_A" }]), now);
    expect(r.action).toBe("flush");
  });

  it("flushes one from a long but plausible outage", () => {
    // A set, a change of ends, a device asleep through half-time.
    const r = decideQueueRestore(
      stamped(QUEUE_MAX_AGE_MS - 60_000, [{ type: "RALLY_WON_A" }]),
      now,
    );
    expect(r.action).toBe("flush");
  });

  it("discards one old enough to belong to an earlier match", () => {
    // The case that matters: replaying yesterday's rallies into today's match.
    const r = decideQueueRestore(
      stamped(QUEUE_MAX_AGE_MS + 60_000, [{ type: "RALLY_WON_A" }]),
      now,
    );
    expect(r.action).toBe("drop");
  });

  it("cannot reach the next match on the same device", () => {
    // Sanity on the constant itself, not just the comparison: a limit of a day
    // would let a queue survive into another fixture on the same tablet.
    expect(QUEUE_MAX_AGE_MS).toBeLessThan(6 * 60 * 60 * 1000);
    expect(QUEUE_MAX_AGE_MS).toBeGreaterThan(60 * 60 * 1000);
  });
});

describe("queue restore tolerance", () => {
  it("does nothing for an absent, empty or unreadable queue", () => {
    expect(decideQueueRestore(null, now).action).toBe("none");
    expect(decideQueueRestore(stamped(0, []), now).action).toBe("none");
    expect(decideQueueRestore("{not json", now).action).toBe("none");
  });

  it("never flushes an unstamped value found in sessionStorage", () => {
    // sessionStorage was introduced together with the stamp, so a bare array
    // there is not history from an older build — it is a corrupt value, and
    // replaying an undatable queue is exactly what the age-out forbids.
    // Whether it reads as "nothing usable" or "too old", the one outcome that
    // must never happen is a flush.
    const r = decideQueueRestore(JSON.stringify([{ type: "RALLY_WON_B" }]), now);
    expect(r.action).not.toBe("flush");
  });

  it("treats a stamped queue with no timestamp as too old", () => {
    const r = decideQueueRestore(
      JSON.stringify({ items: [{ type: "RALLY_WON_A" }] }),
      now,
    );
    expect(r.action).toBe("drop");
  });
});

describe("legacy queue migration (spec/30 Phase E)", () => {
  it("clears the legacy key and reports how much was dropped", () => {
    const r = describeLegacyQueue(
      JSON.stringify([{ type: "RALLY_WON_A" }, { type: "RALLY_WON_B" }]),
    );
    expect(r).toEqual({ cleared: true, droppedCount: 2 });
  });

  it("clears an unreadable legacy value without a message", () => {
    // Nothing useful to tell the scorer, and the key must still go.
    expect(describeLegacyQueue("{not json")).toEqual({
      cleared: true,
      droppedCount: 0,
    });
  });

  it("clears an empty legacy queue silently", () => {
    expect(describeLegacyQueue(JSON.stringify([]))).toEqual({
      cleared: true,
      droppedCount: 0,
    });
  });

  it("does nothing when there is no legacy key", () => {
    expect(describeLegacyQueue(null)).toEqual({
      cleared: false,
      droppedCount: 0,
    });
  });
});
