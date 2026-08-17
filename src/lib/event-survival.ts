/**
 * Which events a log's UNDO/REWIND markers have cancelled (spec/30 Phase D).
 *
 * The complement of `survivingEvents`, and it exists for a different audience.
 * Documents that state a CURRENT score drop cancelled events entirely and
 * re-count (see `scoredSurvivingEvents`). AUDIT views — the scorer's log
 * overlay, the admin event log, the spec/19 event-log PDF — must keep showing
 * them: the log is append-only and its value is that it records what happened,
 * including what was later taken back.
 *
 * What those views were missing is the marking. A reader saw a cancelled rally
 * with its as-recorded score sitting between two surviving ones, and after an
 * F13 fault correction that reads as a score that jumps around for no visible
 * reason. Keeping the row and striking it says both true things at once: this
 * was recorded, and it no longer counts.
 *
 * Pure and dependency-free — the scorer console (client) and the PDF renderers
 * (server) share it.
 */

/** The minimum an event needs for survival to be decidable. */
export interface SurvivableEvent {
  id: string;
  sequence: number;
  payload?: unknown;
  eventType?: string;
}

/**
 * Ids of events cancelled by an UNDO or truncated by a REWIND.
 *
 * Mirrors the survivor pass in `engine/core/factories.ts` — an UNDO drops its
 * target, a REWIND drops everything past its cutoff — but returns what was
 * dropped rather than what remains. The control markers themselves are never
 * reported as cancelled: they are the record OF the cancellation, and striking
 * them through would hide the explanation.
 */
export function cancelledEventIds(events: SurvivableEvent[]): Set<string> {
  const survivors: SurvivableEvent[] = [];
  const cancelled = new Set<string>();

  for (const ev of events) {
    const p = (ev.payload ?? {}) as {
      type?: string;
      targetEventId?: string;
      toSequence?: number;
    };
    const type = p.type ?? ev.eventType;

    if (type === "UNDO") {
      const target = p.targetEventId ?? "";
      const i = survivors.findIndex((s) => s.id === target);
      if (i !== -1) {
        cancelled.add(survivors[i].id);
        survivors.splice(i, 1);
      }
      continue;
    }
    if (type === "REWIND") {
      const cutoff = p.toSequence ?? Number.MAX_SAFE_INTEGER;
      for (let i = survivors.length - 1; i >= 0; i--) {
        if (survivors[i].sequence > cutoff) {
          cancelled.add(survivors[i].id);
          survivors.splice(i, 1);
        }
      }
      continue;
    }
    survivors.push(ev);
  }
  return cancelled;
}
