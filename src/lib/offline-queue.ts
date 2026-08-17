/**
 * The offline queue's persistence decisions (spec/29 Phase 7, spec/30 E).
 *
 * Extracted from the provider for one reason above all: the tests for these
 * rules used to be MIRROR tests — private copies of the logic asserted against
 * themselves — so the provider could drift and the tests would stay green
 * (spec/31 test-suite audit). Now the provider and the tests import the same
 * functions, and a change to either rule fails a test or changes behaviour,
 * never neither.
 *
 * Pure: no storage access, no React. The provider owns the side effects.
 */

/**
 * How stale an unsent queue may be before it is discarded instead of replayed.
 *
 * Long enough to cover a real venue outage and a scorer walking back into
 * range — a set, a change of ends, a device sleeping through half-time. Short
 * enough that it can never reach the NEXT match on the same device, which is
 * the case that would put someone else's rallies into this scoresheet.
 */
export const QUEUE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/** The persisted shape, as the provider writes it. */
export interface PersistedQueue<P> {
  savedAt?: number;
  items?: P[];
}

export type QueueRestoreDecision<P> =
  | { action: "flush"; items: P[] }
  | { action: "drop" }
  | { action: "none" };

/**
 * What to do with a queue found in sessionStorage on mount.
 *
 * Only ever the stamped shape: sessionStorage was introduced together with the
 * stamp, so an unstamped value there is corruption, not history — and an
 * undatable queue counts as too old, because replaying rallies into a match
 * that has since been scored, corrected or signed is the one outcome the
 * age-out exists to prevent.
 */
export function decideQueueRestore<P>(
  raw: string | null,
  now: number,
): QueueRestoreDecision<P> {
  if (!raw) return { action: "none" };
  let parsed: PersistedQueue<P> | P[];
  try {
    parsed = JSON.parse(raw) as PersistedQueue<P> | P[];
  } catch {
    return { action: "none" };
  }
  const items = Array.isArray(parsed) ? [] : (parsed.items ?? []);
  const savedAt = Array.isArray(parsed) ? null : (parsed.savedAt ?? null);
  if (!Array.isArray(items) || items.length === 0) return { action: "none" };
  if (savedAt == null || now - savedAt > QUEUE_MAX_AGE_MS)
    return { action: "drop" };
  return { action: "flush", items };
}

/**
 * What to do with a legacy `localStorage` queue (pre-spec/29-Phase-7 shape).
 *
 * Cleared and NEVER replayed: the legacy shape is a bare array with no
 * timestamp, so its age cannot be bounded — and the loss this risks is largely
 * theoretical, because an OFFLINE scorer cannot load a new build; the old code
 * keeps running and drains its own queue on reconnect. What remains on devices
 * is old keys from sessions long over — exactly what must not be replayed.
 */
export function describeLegacyQueue(legacyRaw: string | null): {
  cleared: boolean;
  droppedCount: number;
} {
  if (!legacyRaw) return { cleared: false, droppedCount: 0 };
  try {
    const items = JSON.parse(legacyRaw) as unknown;
    return {
      cleared: true,
      droppedCount: Array.isArray(items) ? items.length : 0,
    };
  } catch {
    return { cleared: true, droppedCount: 0 };
  }
}
