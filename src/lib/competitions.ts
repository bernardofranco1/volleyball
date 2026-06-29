// Read-side data access for competition administration (Phase 3).
// Mutations live in the *-actions.ts modules; these are query helpers shared by
// the admin Server Components. Every query is scoped by tenantId for isolation.
import { aliasedTable, and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  matches,
  players,
  pools,
  teams,
  tournamentConfig,
} from "@/db/schema";

export type Competition = typeof competitions.$inferSelect;
export type TournamentConfigRow = typeof tournamentConfig.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Pool = typeof pools.$inferSelect;

export async function listCompetitions(
  tenantId: string,
): Promise<Competition[]> {
  return db
    .select()
    .from(competitions)
    .where(eq(competitions.tenantId, tenantId))
    .orderBy(desc(competitions.createdAt));
}

/** A competition scoped to its tenant (null when missing or cross-tenant). */
export async function getCompetition(
  tenantId: string,
  competitionId: string,
): Promise<Competition | null> {
  const rows = await db
    .select()
    .from(competitions)
    .where(
      and(
        eq(competitions.id, competitionId),
        eq(competitions.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getCompetitionConfig(
  competitionId: string,
): Promise<TournamentConfigRow | null> {
  const rows = await db
    .select()
    .from(tournamentConfig)
    .where(eq(tournamentConfig.competitionId, competitionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listTeams(competitionId: string): Promise<Team[]> {
  return db
    .select()
    .from(teams)
    .where(eq(teams.competitionId, competitionId))
    .orderBy(asc(teams.seed), asc(teams.displayName));
}

export async function listPlayersByTeam(
  teamIds: string[],
): Promise<Map<string, Player[]>> {
  const byTeam = new Map<string, Player[]>();
  if (teamIds.length === 0) return byTeam;
  const rows = await db
    .select()
    .from(players)
    .where(inArray(players.teamId, teamIds))
    .orderBy(asc(players.jerseyNumber), asc(players.fullName));
  for (const p of rows) {
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  return byTeam;
}

export async function listPools(competitionId: string): Promise<Pool[]> {
  return db
    .select()
    .from(pools)
    .where(eq(pools.competitionId, competitionId))
    .orderBy(asc(pools.name));
}

export interface MatchRow {
  id: string;
  status: typeof matches.status.enumValues[number];
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
  courtNumber: number | null;
  scheduledAt: Date | null;
  roundName: string | null;
  matchNumber: number | null;
}

/** Matches for a competition with both team display names joined in. */
export async function listMatches(competitionId: string): Promise<MatchRow[]> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const rows = await db
    .select({
      id: matches.id,
      status: matches.status,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      setsWonA: matches.setsWonA,
      setsWonB: matches.setsWonB,
      winner: matches.winner,
      courtNumber: matches.courtNumber,
      scheduledAt: matches.scheduledAt,
      roundName: matches.roundName,
      matchNumber: matches.matchNumber,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(eq(matches.competitionId, competitionId))
    .orderBy(asc(matches.matchNumber), asc(matches.scheduledAt));
  return rows;
}

export async function getMatch(
  tenantId: string,
  matchId: string,
): Promise<
  | (MatchRow & {
      competitionId: string;
      discipline: string;
      teamAColor: string | null;
      teamBColor: string | null;
    })
  | null
> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const rows = await db
    .select({
      id: matches.id,
      competitionId: matches.competitionId,
      discipline: matches.discipline,
      status: matches.status,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      setsWonA: matches.setsWonA,
      setsWonB: matches.setsWonB,
      winner: matches.winner,
      courtNumber: matches.courtNumber,
      scheduledAt: matches.scheduledAt,
      roundName: matches.roundName,
      matchNumber: matches.matchNumber,
      teamAColor: teamA.color,
      teamBColor: teamB.color,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
