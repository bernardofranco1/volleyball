// Event-log integrity (Phase 11). The append-only log for a match should hold
// sequences 1..N with no gaps or duplicates (UNDO appends a new event, never
// deletes). A gap means events were dropped/lost; a duplicate means a broken
// write — either is a real bug worth surfacing. The unique(matchId, sequence)
// constraint already prevents duplicates, so this mainly catches gaps + provides
// an admin-visible health signal.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";

export interface SequenceReport {
  count: number;
  max: number;
  gaps: number[];
  duplicates: number[];
  ok: boolean;
}

/** Pure: find missing and repeated sequence numbers in 1..max. */
export function findSequenceGaps(sequences: number[]): SequenceReport {
  const seen = new Map<number, number>();
  let max = 0;
  for (const s of sequences) {
    seen.set(s, (seen.get(s) ?? 0) + 1);
    if (s > max) max = s;
  }
  const gaps: number[] = [];
  for (let i = 1; i <= max; i++) if (!seen.has(i)) gaps.push(i);
  const duplicates = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([s]) => s)
    .sort((a, b) => a - b);
  return {
    count: sequences.length,
    max,
    gaps,
    duplicates,
    ok: gaps.length === 0 && duplicates.length === 0,
  };
}

/** Load a match's event sequences and report gaps/duplicates. */
export async function checkEventIntegrity(
  matchId: string,
): Promise<SequenceReport> {
  const rows = await db
    .select({ sequence: events.sequence })
    .from(events)
    .where(eq(events.matchId, matchId))
    .orderBy(asc(events.sequence));
  return findSequenceGaps(rows.map((r) => r.sequence));
}
