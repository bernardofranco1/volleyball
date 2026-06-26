// Read-side helpers for pools and the knockout bracket (standings + public
// results pages). Mutations live in tournament-actions.ts.
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, pools, teams } from "@/db/schema";
import { isKnockoutRound, roundOrderIndex } from "@/lib/bracket";

export async function listPoolsWithTeams(competitionId: string) {
  const [poolRows, teamRows] = await Promise.all([
    db
      .select({ id: pools.id, name: pools.name })
      .from(pools)
      .where(eq(pools.competitionId, competitionId))
      .orderBy(asc(pools.name)),
    db
      .select({
        id: teams.id,
        displayName: teams.displayName,
        poolId: teams.poolId,
      })
      .from(teams)
      .where(eq(teams.competitionId, competitionId))
      .orderBy(asc(teams.seed), asc(teams.displayName)),
  ]);
  return { pools: poolRows, teams: teamRows };
}

export interface BracketMatch {
  id: string;
  roundName: string;
  teamAName: string;
  teamBName: string;
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
  status: string;
}

/** Knockout matches grouped by round (earliest round first) for the visual. */
export async function loadBracket(
  competitionId: string,
): Promise<{ round: string; matches: BracketMatch[] }[]> {
  const rows = await db
    .select({
      id: matches.id,
      roundName: matches.roundName,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      setsWonA: matches.setsWonA,
      setsWonB: matches.setsWonB,
      winner: matches.winner,
      status: matches.status,
      matchNumber: matches.matchNumber,
    })
    .from(matches)
    .where(eq(matches.competitionId, competitionId));
  const knockout = rows.filter((m) => isKnockoutRound(m.roundName));
  if (knockout.length === 0) return [];

  const teamIds = Array.from(
    new Set(knockout.flatMap((m) => [m.teamAId, m.teamBId])),
  );
  const nameRows = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(inArray(teams.id, teamIds));
  const nameOf = new Map(nameRows.map((t) => [t.id, t.displayName]));

  const byRound = new Map<string, BracketMatch[]>();
  for (const m of knockout.sort(
    (x, y) => (x.matchNumber ?? 0) - (y.matchNumber ?? 0),
  )) {
    const list = byRound.get(m.roundName!) ?? [];
    list.push({
      id: m.id,
      roundName: m.roundName!,
      teamAName: nameOf.get(m.teamAId) ?? "?",
      teamBName: nameOf.get(m.teamBId) ?? "?",
      setsWonA: m.setsWonA,
      setsWonB: m.setsWonB,
      winner: m.winner,
      status: m.status,
    });
    byRound.set(m.roundName!, list);
  }

  return Array.from(byRound.entries())
    .map(([round, ms]) => ({ round, matches: ms }))
    .sort((a, b) => roundOrderIndex(a.round) - roundOrderIndex(b.round));
}
