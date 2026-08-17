/**
 * Per-set final scores, from the authoritative snapshot (spec/30 Phase C).
 *
 * Two readers used to aggregate `MAX(events.scoreAfter*)` over RAW event rows:
 * the match-centre set pills and — far more consequentially — the standings'
 * points ratio, which breaks ranking ties.
 *
 * That aggregate counts events that no longer exist. UNDO and REWIND are
 * resolved by replay, not by deleting rows, so an undone rally still
 * contributes its score to a `MAX`. The error used to be bounded and was
 * documented as such ("a point removed by an UNDO at the very end of a set can
 * leave the max one ahead") — but F13's fault correction cancels points in the
 * MIDDLE of a set, several at a time, so the bound is gone: a corrected set can
 * report a score several points above the truth, and a wrong points ratio is a
 * wrong ranking.
 *
 * `matches.state_snapshot` is the replayed state and is force-refreshed
 * whenever a match leaves LIVE (see `shouldSnapshot`), so for a FINISHED match
 * it is exactly the truth the scoresheet prints — at the cost of one already-
 * fetched jsonb column instead of an aggregate query. The MAX aggregate
 * survives only as the fallback for rows that have no usable snapshot (legacy
 * matches, imports) and for the IN-PROGRESS set of a live match, where the
 * snapshot may lag by up to SNAPSHOT_EVERY events.
 */
import { and, asc, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, matches } from "@/db/schema";

export interface SetScore {
  a: number;
  b: number;
}

/** The slice of a persisted engine snapshot this module needs. */
interface SnapshotShape {
  sets?: {
    setNumber?: number;
    scoreA?: number;
    scoreB?: number;
    winner?: "A" | "B" | null;
  }[];
}

/**
 * Per-set finals for each match id.
 *
 * FINISHED matches come from the snapshot; anything else falls back to the MAX
 * aggregate, which is fresher for a set still being played. A match whose
 * snapshot is missing or malformed also falls back, so no row can be lost to a
 * shape change.
 */
export async function loadSetScoresAuthoritative(
  matchIds: string[],
): Promise<Map<string, SetScore[]>> {
  const byMatch = new Map<string, SetScore[]>();
  if (matchIds.length === 0) return byMatch;

  const rows = await db
    .select({
      id: matches.id,
      status: matches.status,
      snapshot: matches.stateSnapshot,
    })
    .from(matches)
    .where(inArray(matches.id, matchIds));

  const needsAggregate: string[] = [];
  for (const r of rows) {
    const fromSnap =
      r.status === "FINISHED" ? setsFromSnapshot(r.snapshot) : null;
    if (fromSnap) byMatch.set(r.id, fromSnap);
    else needsAggregate.push(r.id);
  }

  if (needsAggregate.length > 0) {
    for (const [id, sets] of await maxAggregate(needsAggregate))
      byMatch.set(id, sets);
  }
  return byMatch;
}

/**
 * Sets from a persisted snapshot, or null when it cannot be trusted.
 *
 * A set with no winner is dropped: on a FINISHED match that is an unplayed set
 * the engine never materialized (a forfeit closes the match without inventing
 * the rest), and printing it as 0-0 would invent a result.
 */
function setsFromSnapshot(snapshot: unknown): SetScore[] | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const sets = (snapshot as SnapshotShape).sets;
  if (!Array.isArray(sets) || sets.length === 0) return null;
  const out: SetScore[] = [];
  for (const s of [...sets].sort((x, y) => (x.setNumber ?? 0) - (y.setNumber ?? 0))) {
    if (!s || typeof s !== "object") return null;
    if (!s.winner) continue;
    out.push({ a: Number(s.scoreA ?? 0), b: Number(s.scoreB ?? 0) });
  }
  return out.length > 0 ? out : null;
}

/** The historical aggregate — see the module note for what it can get wrong. */
async function maxAggregate(
  matchIds: string[],
): Promise<Map<string, SetScore[]>> {
  const byMatch = new Map<string, SetScore[]>();
  const rows = await db
    .select({
      matchId: events.matchId,
      setNumber: events.setNumber,
      a: max(events.scoreAfterA),
      b: max(events.scoreAfterB),
    })
    .from(events)
    .where(
      and(inArray(events.matchId, matchIds), sql`${events.setNumber} is not null`),
    )
    .groupBy(events.matchId, events.setNumber)
    .orderBy(asc(events.matchId), asc(events.setNumber));
  for (const r of rows) {
    const list = byMatch.get(r.matchId) ?? [];
    list.push({ a: r.a ?? 0, b: r.b ?? 0 });
    byMatch.set(r.matchId, list);
  }
  return byMatch;
}

/**
 * Total points for and against, per match, for the standings' points ratio.
 *
 * Only ever called with FINISHED matches, which is exactly the case the
 * snapshot answers authoritatively.
 */
export async function loadMatchPointTotals(
  matchIds: string[],
): Promise<Map<string, SetScore>> {
  const perMatch = new Map<string, SetScore>();
  const setScores = await loadSetScoresAuthoritative(matchIds);
  for (const [id, sets] of setScores) {
    const total = sets.reduce(
      (acc, s) => ({ a: acc.a + s.a, b: acc.b + s.b }),
      { a: 0, b: 0 },
    );
    perMatch.set(id, total);
  }
  return perMatch;
}

/** Exported for tests — the snapshot parse is where a shape change would bite. */
export const __testing = { setsFromSnapshot };
