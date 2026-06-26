// On-the-fly standings computation (spec/10 §"Pool play"). Aggregated from the
// denormalised matches columns (sets) plus the events log (points per set). No
// stored standings table — recomputed on each request, which is fine at the
// scale of a single competition.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, matches, pools, teams } from "@/db/schema";

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
 * Standings grouped by pool. Teams with no pool assignment collapse into a
 * single "Overall" group. Tiebreakers: W → set ratio → point ratio → name.
 * (Head-to-head — the final spec tiebreaker — lands with the full bracket
 * algorithm in Phase 8.)
 */
export async function computeStandings(
  competitionId: string,
): Promise<StandingsGroup[]> {
  const teamRows = await db
    .select({
      id: teams.id,
      displayName: teams.displayName,
      poolId: teams.poolId,
    })
    .from(teams)
    .where(eq(teams.competitionId, competitionId));
  if (teamRows.length === 0) return [];

  const finished = await db
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
    );

  // Points per match per team, from the per-set max denormalised scores.
  const pointsByMatch = new Map<string, { a: number; b: number }>();
  if (finished.length > 0) {
    const evRows = await db
      .select({
        matchId: events.matchId,
        setNumber: events.setNumber,
        scoreAfterA: events.scoreAfterA,
        scoreAfterB: events.scoreAfterB,
      })
      .from(events)
      .where(
        inArray(
          events.matchId,
          finished.map((m) => m.id),
        ),
      );
    // max score per (match, set)
    const perSet = new Map<string, { a: number; b: number }>();
    for (const e of evRows) {
      if (e.setNumber == null) continue;
      const key = `${e.matchId}#${e.setNumber}`;
      const cur = perSet.get(key) ?? { a: 0, b: 0 };
      cur.a = Math.max(cur.a, e.scoreAfterA ?? 0);
      cur.b = Math.max(cur.b, e.scoreAfterB ?? 0);
      perSet.set(key, cur);
    }
    for (const [key, v] of perSet) {
      const matchId = key.slice(0, key.indexOf("#"));
      const cur = pointsByMatch.get(matchId) ?? { a: 0, b: 0 };
      cur.a += v.a;
      cur.b += v.b;
      pointsByMatch.set(matchId, cur);
    }
  }

  // Aggregate per team.
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
    } else if (m.winner === "B") {
      b.w++;
      a.l++;
    }
  }

  for (const row of agg.values()) {
    row.srNum = ratio(row.sw, row.sl);
    row.prNum = ratio(row.pw, row.pl);
  }

  // Group by pool.
  const poolRows = await db
    .select({ id: pools.id, name: pools.name })
    .from(pools)
    .where(eq(pools.competitionId, competitionId));
  const poolName = new Map(poolRows.map((p) => [p.id, p.name]));

  const groups = new Map<string, StandingRow[]>();
  for (const t of teamRows) {
    const key = t.poolId ?? "__overall__";
    const list = groups.get(key) ?? [];
    list.push(agg.get(t.id)!);
    groups.set(key, list);
  }

  const sortRows = (rows: StandingRow[]) =>
    rows.sort(
      (x, y) =>
        y.w - x.w ||
        y.srNum - x.srNum ||
        y.prNum - x.prNum ||
        x.teamName.localeCompare(y.teamName),
    );

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
