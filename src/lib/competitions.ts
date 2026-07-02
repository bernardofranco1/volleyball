// Read-side data access for competition administration (Phase 3).
// Mutations live in the *-actions.ts modules; these are query helpers shared by
// the admin Server Components. Every query is scoped by tenantId for isolation.
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
} from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  matches,
  players,
  pools,
  teams,
  tournamentConfig,
} from "@/db/schema";
import { isCompetitionStatus, isDiscipline } from "@/lib/domain";

export type Competition = typeof competitions.$inferSelect;
export type TournamentConfigRow = typeof tournamentConfig.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Pool = typeof pools.$inferSelect;

export async function listCompetitions(
  tenantId: string,
  filters: { discipline?: string; status?: string; q?: string } = {},
): Promise<Competition[]> {
  const conds = [eq(competitions.tenantId, tenantId)];
  if (filters.discipline && isDiscipline(filters.discipline))
    conds.push(eq(competitions.discipline, filters.discipline));
  if (filters.status && isCompetitionStatus(filters.status))
    conds.push(eq(competitions.status, filters.status));
  if (filters.q)
    conds.push(ilike(competitions.name, `%${filters.q.replaceAll("%", "\\%")}%`));
  return db
    .select()
    .from(competitions)
    .where(and(...conds))
    .orderBy(desc(competitions.createdAt));
}

/** Team/match totals for the overview page — counts only, not full row sets. */
export async function competitionCounts(
  competitionId: string,
): Promise<{ teams: number; matches: number }> {
  const [t, m] = await Promise.all([
    db
      .select({ n: count() })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({ n: count() })
      .from(matches)
      .where(eq(matches.competitionId, competitionId)),
  ]);
  return { teams: t[0]?.n ?? 0, matches: m[0]?.n ?? 0 };
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

export interface TenantMatchRow {
  id: string;
  competitionId: string;
  competitionName: string;
  competitionColor: string | null;
  discipline: typeof matches.discipline.enumValues[number];
  status: typeof matches.status.enumValues[number];
  teamAName: string;
  teamBName: string;
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
  courtNumber: number | null;
  scheduledAt: Date | null;
}

export const MATCHES_PAGE_SIZE = 50;

/**
 * All matches across a tenant's competitions, with optional discipline/status
 * filters, date ordering, and pagination — powers the tenant-wide schedule
 * page. "scheduled" groups the pre-live statuses (SCHEDULED/WARMUP/COIN_TOSS).
 * Fetches one row beyond the page so callers know whether a next page exists
 * without a COUNT query.
 */
export async function listTenantMatches(
  tenantId: string,
  opts: {
    discipline?: string;
    status?: "scheduled" | "live" | "finished";
    order?: "asc" | "desc";
    page?: number;
  } = {},
): Promise<{ rows: TenantMatchRow[]; hasMore: boolean }> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const conds = [eq(matches.tenantId, tenantId)];
  const disciplines = matches.discipline.enumValues as readonly string[];
  if (opts.discipline && disciplines.includes(opts.discipline))
    conds.push(
      eq(
        matches.discipline,
        opts.discipline as (typeof matches.discipline.enumValues)[number],
      ),
    );
  if (opts.status === "live") conds.push(eq(matches.status, "LIVE"));
  else if (opts.status === "finished")
    conds.push(eq(matches.status, "FINISHED"));
  else if (opts.status === "scheduled")
    conds.push(inArray(matches.status, ["SCHEDULED", "WARMUP", "COIN_TOSS"]));
  const dir = opts.order === "desc" ? desc : asc;
  const page = Math.max(0, opts.page ?? 0);
  const rows = await db
    .select({
      id: matches.id,
      competitionId: matches.competitionId,
      competitionName: competitions.name,
      competitionColor: competitions.color,
      discipline: matches.discipline,
      status: matches.status,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      setsWonA: matches.setsWonA,
      setsWonB: matches.setsWonB,
      winner: matches.winner,
      courtNumber: matches.courtNumber,
      scheduledAt: matches.scheduledAt,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(...conds))
    .orderBy(dir(matches.scheduledAt))
    .limit(MATCHES_PAGE_SIZE + 1)
    .offset(page * MATCHES_PAGE_SIZE);
  return {
    rows: rows.slice(0, MATCHES_PAGE_SIZE),
    hasMore: rows.length > MATCHES_PAGE_SIZE,
  };
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

/** Both teams' players (for the indoor scoreboard rotation). */
export async function loadMatchRosters(matchId: string): Promise<{
  rosterA: { id: string; fullName: string; jerseyNumber: number | null; isLibero: boolean }[];
  rosterB: { id: string; fullName: string; jerseyNumber: number | null; isLibero: boolean }[];
}> {
  const m = (
    await db
      .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  if (!m) return { rosterA: [], rosterB: [] };
  const rows = await db
    .select({
      id: players.id,
      teamId: players.teamId,
      fullName: players.fullName,
      jerseyNumber: players.jerseyNumber,
      isLibero: players.isLibero,
    })
    .from(players)
    .where(inArray(players.teamId, [m.teamAId, m.teamBId]));
  const lite = (teamId: string) =>
    rows
      .filter((r) => r.teamId === teamId)
      .map((r) => ({
        id: r.id,
        fullName: r.fullName,
        jerseyNumber: r.jerseyNumber,
        isLibero: r.isLibero,
      }));
  return { rosterA: lite(m.teamAId), rosterB: lite(m.teamBId) };
}
