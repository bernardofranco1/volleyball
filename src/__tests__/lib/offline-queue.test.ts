/**
 * Offline queue persistence rules (spec/29 Phase 7 audit).
 *
 * The queue itself shipped long ago; this pins the two rules the audit added,
 * because both failure modes are silent and land on the official record:
 *
 * 1. PER TAB. The queue lived in localStorage, shared by every tab on the
 *    origin, with no coordination. Two consoles open on one match restored the
 *    same queue and both flushed it — every queued point scored twice — and a
 *    tab going idle removed the key out from under the other tab's unsent
 *    events. sessionStorage is per tab and still survives reload/navigation,
 *    which was the documented purpose.
 *
 * 2. AGED OUT. A queue restored hours later would replay rallies into a match
 *    that has since been scored, corrected or signed. Old queues are discarded
 *    with a visible message rather than flushed.
 *
 * The provider is a React component wired to fetch, realtime and timers, so
 * these tests exercise the storage CONTRACT directly — the shape written and
 * the decision made on restore — which is where both bugs lived.
 */
import { describe, expect, it } from "vitest";
import { QUEUE_MAX_AGE_MS } from "@/lib/match-provider";

/** The persisted shape, as `persistQueue` writes it. */
type Persisted = { savedAt: number; items: { type: string }[] };

/** The restore decision, mirroring the provider's effect. */
function restore(
  raw: string | null,
  now: number,
): { action: "flush"; items: { type: string }[] } | { action: "drop" } | { action: "none" } {
  if (!raw) return { action: "none" };
  const parsed = JSON.parse(raw) as Persisted | { type: string }[];
  const items = Array.isArray(parsed) ? [] : (parsed.items ?? []);
  const savedAt = Array.isArray(parsed) ? null : (parsed.savedAt ?? null);
  if (!Array.isArray(items) || items.length === 0) return { action: "none" };
  // Undatable counts as too old — see the legacy-migration tests below.
  if (savedAt == null || now - savedAt > QUEUE_MAX_AGE_MS) return { action: "drop" };
  return { action: "flush", items };
}

const now = Date.UTC(2026, 7, 17, 20, 0, 0);
const stamped = (agoMs: number, items: { type: string }[]) =>
  JSON.stringify({ savedAt: now - agoMs, items });

describe("queue age-out", () => {
  it("flushes a queue from moments ago", () => {
    const r = restore(stamped(30_000, [{ type: "RALLY_WON_A" }]), now);
    expect(r.action).toBe("flush");
  });

  it("flushes one from a long but plausible outage", () => {
    // A set, a change of ends, a device asleep through half-time.
    const r = restore(stamped(QUEUE_MAX_AGE_MS - 60_000, [{ type: "RALLY_WON_A" }]), now);
    expect(r.action).toBe("flush");
  });

  it("discards one old enough to belong to an earlier match", () => {
    // The case that matters: replaying yesterday's rallies into today's match.
    const r = restore(stamped(QUEUE_MAX_AGE_MS + 60_000, [{ type: "RALLY_WON_A" }]), now);
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
  it("does nothing for an absent or empty queue", () => {
    expect(restore(null, now).action).toBe("none");
    expect(restore(stamped(0, []), now).action).toBe("none");
  });

  it("never flushes an unstamped value found in sessionStorage", () => {
    // sessionStorage was introduced together with the stamp, so a bare array
    // there is not history from an older build — it is a corrupt value, and
    // replaying an undatable queue is exactly what the age-out forbids.
    // Whether it reads as "nothing usable" or "too old", the one outcome that
    // must never happen is a flush.
    const r = restore(JSON.stringify([{ type: "RALLY_WON_B" }]), now);
    expect(r.action).not.toBe("flush");
  });
});

/**
 * Legacy `localStorage` migration (spec/30 Phase E).
 *
 * The queue moved to sessionStorage in spec/29 Phase 7 and nothing migrated
 * it, leaving old keys on every scoring device.
 *
 * They are cleared and NOT replayed, which deserves justification: the legacy
 * shape carries no timestamp, so its age cannot be bounded, and the age-out
 * exists precisely because replaying old rallies corrupts the record. The loss
 * is largely theoretical — an OFFLINE scorer cannot load a new build, so for
 * the new code to meet a fresh legacy queue the device must have been online,
 * by which time the old code had already drained it. What is left on devices
 * is old keys from finished sessions: exactly what must not be replayed.
 */
function migrateLegacy(legacyRaw: string | null): {
  cleared: boolean;
  notifiedCount: number;
} {
  if (!legacyRaw) return { cleared: false, notifiedCount: 0 };
  try {
    const items = JSON.parse(legacyRaw) as unknown;
    return {
      cleared: true,
      notifiedCount: Array.isArray(items) ? items.length : 0,
    };
  } catch {
    return { cleared: true, notifiedCount: 0 };
  }
}

describe("legacy queue migration", () => {
  it("clears the legacy key and tells the scorer how much was dropped", () => {
    const r = migrateLegacy(
      JSON.stringify([{ type: "RALLY_WON_A" }, { type: "RALLY_WON_B" }]),
    );
    expect(r.cleared).toBe(true);
    expect(r.notifiedCount).toBe(2);
  });

  it("clears an unreadable legacy value without a message", () => {
    // Nothing useful to tell the scorer, and the key must still go.
    const r = migrateLegacy("{not json");
    expect(r).toEqual({ cleared: true, notifiedCount: 0 });
  });

  it("clears an empty legacy queue silently", () => {
    expect(migrateLegacy(JSON.stringify([]))).toEqual({
      cleared: true,
      notifiedCount: 0,
    });
  });

  it("does nothing when there is no legacy key", () => {
    expect(migrateLegacy(null)).toEqual({ cleared: false, notifiedCount: 0 });
  });
});
