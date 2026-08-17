// On-the-fly standings computation (spec/10 §"Pool play"). Aggregated from the
// denormalised matches columns (sets) plus per-match point totals read from
// each finished match's replayed snapshot (spec/30 Phase C — a MAX over raw
// event rows counted points that UNDO/REWIND had already removed). No stored
// standings table — recomputed per request, which is fine at the scale of a
// single competition.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { loadMatchPointTotals } from "@/lib/match-scores";
import { matches, pools, teams } from "@/db/schema";

export interface StandingRow {
  teamId: string;
  teamName: string;
  mp: number; // matches played
  w: number; // wins
  l: number; // losses
  sw: number; // sets won
  sl: number; // sets lost
  srNum: number; // set ratio (Infinity when sl === 0 and sw > 0)
  pw: number; // points won
  pl: number; // points lost
  prNum: number; // point ratio
}

export interface StandingsGroup {
  name: string;
  rows: StandingRow[];
}

export interface StandingsTeam {
  id: string;
  displayName: string;
  poolId: string | null;
}

export interface FinishedMatch {
  id: string;
  teamAId: string;
  teamBId: string;
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
}

function ratio(won: number, lost: number): number {
  if (lost === 0) return won === 0 ? 0 : Infinity;
  return won / lost;
}

/** Format a ratio for display: 2 decimals, or "∞" / "–". */
export function fmtRatio(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n === 0) return "–";
  return n.toFixed(3);
}

/**
 * Pure standings aggregation over pre-fetched rows (exported for tests).
 *
 * Pool scoping: when a match's two teams belong to the same pool (or both are
 * unpooled), it counts toward that group's table. Cross-pool matches — e.g.
 * knockout rounds after pool play — are excluded from pool tables so a pool
 * standing reflects only pool play. When no pools exist every match counts.
 * Tiebreakers: W → set ratio → point ratio → head-to-head → name.
 */
export function buildStandings(
  teamRows: StandingsTeam[],
  finished: FinishedMatch[],
  pointsByMatch: Map<string, { a: number; b: number }>,
  poolName: Map<string, string>,
): StandingsGroup[] {
  if (teamRows.length === 0) return [];
  const poolOf = new Map(teamRows.map((t) => [t.id, t.poolId ?? null]));
  const hasPools = teamRows.some((t) => t.poolId != null);

  // Head-to-head wins: h2h[winnerTeamId][loserTeamId] = count.
  const h2h = new Map<string, Map<string, number>>();
  const bumpH2H = (winner: string, loser: string) => {
    const row = h2h.get(winner) ?? new Map<string, number>();
    row.set(loser, (row.get(loser) ?? 0) + 1);
    h2h.set(winner, row);
  };

  const agg = new Map<string, StandingRow>();
  for (const t of teamRows) {
    agg.set(t.id, {
      teamId: t.id,
      teamName: t.displayName,
      mp: 0,
      w: 0,
      l: 0,
      sw: 0,
      sl: 0,
      srNum: 0,
      pw: 0,
      pl: 0,
      prNum: 0,
    });
  }

  for (const m of finished) {
    const a = agg.get(m.teamAId);
    const b = agg.get(m.teamBId);
    if (!a || !b) continue; // team outside this competition (shouldn't happen)
    // Pool scoping (see doc comment above).
    if (hasPools && poolOf.get(m.teamAId) !== poolOf.get(m.teamBId)) continue;
    const pts = pointsByMatch.get(m.id) ?? { a: 0, b: 0 };

    a.mp++;
    b.mp++;
    a.sw += m.setsWonA;
    a.sl += m.setsWonB;
    b.sw += m.setsWonB;
    b.sl += m.setsWonA;
    a.pw += pts.a;
    a.pl += pts.b;
    b.pw += pts.b;
    b.pl += pts.a;
    if (m.winner === "A") {
      a.w++;
      b.l++;
      bumpH2H(m.teamAId, m.teamBId);
    } else if (m.winner === "B") {
      b.w++;
      a.l++;
      bumpH2H(m.teamBId, m.teamAId);
    }
  }

  for (const row of agg.values()) {
    row.srNum = ratio(row.sw, row.sl);
    row.prNum = ratio(row.pw, row.pl);
  }

  const groups = new Map<string, StandingRow[]>();
  for (const t of teamRows) {
    const key = t.poolId ?? "__overall__";
    const list = groups.get(key) ?? [];
    list.push(agg.get(t.id)!);
    groups.set(key, list);
  }

  const sortRows = (rows: StandingRow[]) =>
    rows.sort((x, y) => {
      if (y.w !== x.w) return y.w - x.w;
      if (y.srNum !== x.srNum) return y.srNum - x.srNum;
      if (y.prNum !== x.prNum) return y.prNum - x.prNum;
      const xBeatY = h2h.get(x.teamId)?.get(y.teamId) ?? 0;
      const yBeatX = h2h.get(y.teamId)?.get(x.teamId) ?? 0;
      if (xBeatY !== yBeatX) return yBeatX - xBeatY;
      return x.teamName.localeCompare(y.teamName);
    });

  const result: StandingsGroup[] = [];
  for (const [key, rows] of groups) {
    result.push({
      name:
        key === "__overall__"
          ? groups.size > 1
            ? "Unpooled"
            : "Standings"
          : (poolName.get(key) ?? "Pool"),
      rows: sortRows(rows),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function computeStandings(
  competitionId: string,
): Promise<StandingsGroup[]> {
  const [teamRows, finished, poolRows] = await Promise.all([
    db
      .select({
        id: teams.id,
        displayName: teams.displayName,
        poolId: teams.poolId,
      })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({
        id: matches.id,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        setsWonA: matches.setsWonA,
        setsWonB: matches.setsWonB,
        winner: matches.winner,
      })
      .from(matches)
      .where(
        and(
          eq(matches.competitionId, competitionId),
          eq(matches.status, "FINISHED"),
        ),
      ),
    db
      .select({ id: pools.id, name: pools.name })
      .from(pools)
      .where(eq(pools.competitionId, competitionId)),
  ]);
  if (teamRows.length === 0) return [];

  // Points per match per team, for the points ratio that breaks ranking ties.
  //
  // Read from the replayed snapshot, NOT from a MAX over raw event rows
  // (spec/30 Phase C). UNDO and REWIND are resolved by replay rather than by
  // deleting rows, so an undone rally still contributes to a MAX — and F13's
  // fault correction cancels several points mid-set, so the old error is no
  // longer the bounded "one ahead" the comment used to promise. A wrong points
  // ratio is a wrong ranking.
  const pointsByMatch =
    finished.length > 0
      ? await loadMatchPointTotals(finished.map((m) => m.id))
      : new Map<string, { a: number; b: number }>();

  const poolName = new Map(poolRows.map((p) => [p.id, p.name]));
  return buildStandings(teamRows, finished, pointsByMatch, poolName);
}
