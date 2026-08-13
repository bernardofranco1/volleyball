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
  max,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  events,
  matches,
  people,
  players,
  pools,
  teams,
  tournamentConfig,
} from "@/db/schema";
import { DISCIPLINES, isCompetitionStatus, isDiscipline } from "@/lib/domain";

export type Competition = typeof competitions.$inferSelect;
export type TournamentConfigRow = typeof tournamentConfig.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type PlayerRowRaw = typeof players.$inferSelect;

/**
 * A roster row joined to its person (spec/24 §2.3, spec/26).
 *
 * `jerseyName` is the ONLY name that belongs on a match output — console,
 * scoreboard, substitutions, e-scoresheets, exports. `firstName`/`lastName` are
 * registration data, for admin surfaces only.
 */
export interface Player {
  id: string;
  teamId: string;
  tenantId: string;
  personId: string;
  firstName: string | null;
  lastName: string | null;
  jerseyName: string;
  jerseyNumber: number | null;
  isCaptain: boolean;
  isLibero: boolean;
  role: "PLAYER" | "BENCH" | "STAFF";
}
export type Pool = typeof pools.$inferSelect;

/**
 * Which disciplines a tenant's filter dropdowns should offer: everything it is
 * currently allowed to create, plus anything already sitting in its data
 * (spec/24 §5.2, A1). Disabling a discipline is forward-looking — it stops new
 * competitions, it does not hide or break existing ones, so those must stay
 * filterable. Returned in the canonical DISCIPLINES order.
 */
export async function disciplineFilterOptions(
  tenantId: string,
  enabled: readonly string[],
): Promise<string[]> {
  const used = await db
    .selectDistinct({ discipline: competitions.discipline })
    .from(competitions)
    .where(eq(competitions.tenantId, tenantId));
  const set = new Set<string>([...enabled, ...used.map((r) => r.discipline)]);
  return DISCIPLINES.filter((d) => set.has(d));
}

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
  // A roster row IS a person now (spec/24 §2.3 contract migration): the name
  // columns are gone from players, so this is an inner join, not a fallback.
  const rows = await db
    .select({
      id: players.id,
      teamId: players.teamId,
      tenantId: players.tenantId,
      personId: players.personId,
      firstName: people.firstName,
      lastName: people.lastName,
      jerseyName: people.jerseyName,
      jerseyNumber: players.jerseyNumber,
      isCaptain: players.isCaptain,
      isLibero: players.isLibero,
      role: players.role,
    })
    .from(players)
    .innerJoin(people, eq(people.id, players.personId))
    .where(inArray(players.teamId, teamIds))
    .orderBy(asc(players.jerseyNumber), asc(people.jerseyName));
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
  roundName: string | null;
  matchNumber: number | null;
}

export const MATCHES_PAGE_SIZE = 50;

export type MatchStatusFilter = "scheduled" | "live" | "pending" | "finished";

export interface TenantMatchFilters {
  discipline?: string;
  competitionId?: string;
  /** Free text over both team names, the competition name and the round. */
  q?: string;
  status?: MatchStatusFilter;
}

/**
 * Filter predicates for the match centre, shared by the page query, the chip
 * counts and the CSV export so the three can never disagree about what "live"
 * or "pending" means.
 */
function tenantMatchConditions(
  tenantId: string,
  f: TenantMatchFilters,
  teamA: typeof teams,
  teamB: typeof teams,
) {
  const conds = [eq(matches.tenantId, tenantId)];
  const disciplines = matches.discipline.enumValues as readonly string[];
  if (f.discipline && disciplines.includes(f.discipline))
    conds.push(
      eq(
        matches.discipline,
        f.discipline as (typeof matches.discipline.enumValues)[number],
      ),
    );
  if (f.competitionId)
    conds.push(eq(matches.competitionId, f.competitionId));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const or = sql`(${teamA.displayName} ilike ${like} or ${teamB.displayName} ilike ${like} or ${competitions.name} ilike ${like} or coalesce(${matches.roundName}, '') ilike ${like})`;
    conds.push(or);
  }
  const s = statusCondition(f.status);
  if (s) conds.push(s);
  return conds;
}

/**
 * "finished" deliberately means every status that has a result to look at, not
 * just FINISHED: a match awaiting confirmation, abandoned or forfeited used to
 * fall out of all filter buckets and was reachable only from the unfiltered
 * list — which is exactly where someone goes looking for its report
 * (spec/24 §3.4). PENDING_CONFIRMATION additionally gets its own chip, because
 * "what still needs signing off" is a daily question.
 */
function statusCondition(status: MatchStatusFilter | undefined) {
  switch (status) {
    case "live":
      return eq(matches.status, "LIVE");
    case "pending":
      return eq(matches.status, "PENDING_CONFIRMATION");
    case "finished":
      return inArray(matches.status, [
        "PENDING_CONFIRMATION",
        "FINISHED",
        "ABANDONED",
      ]);
    case "scheduled":
      return inArray(matches.status, ["SCHEDULED", "WARMUP", "COIN_TOSS"]);
    default:
      return undefined;
  }
}

/**
 * How many matches sit in each status bucket under the current non-status
 * filters — the numbers on the filter chips. One grouped query rather than four
 * counts, then folded into buckets in JS.
 */
export async function matchStatusCounts(
  tenantId: string,
  filters: Omit<TenantMatchFilters, "status">,
): Promise<Record<MatchStatusFilter | "all", number>> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const rows = await db
    .select({ status: matches.status, n: count() })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(...tenantMatchConditions(tenantId, filters, teamA, teamB)))
    .groupBy(matches.status);

  const out = { all: 0, scheduled: 0, live: 0, pending: 0, finished: 0 };
  for (const r of rows) {
    out.all += r.n;
    if (r.status === "LIVE") out.live += r.n;
    else if (r.status === "PENDING_CONFIRMATION") {
      out.pending += r.n;
      out.finished += r.n;
    } else if (r.status === "FINISHED" || r.status === "ABANDONED")
      out.finished += r.n;
    else out.scheduled += r.n;
  }
  return out;
}

/**
 * Final score of every set of the given matches, so the match centre can show
 * "25-16 · 25-12 · 25-19" instead of just the set tally.
 *
 * Per-set MAX over the denormalised event scores — the same aggregate the
 * standings use (≤ matches × sets rows, no replay). A point removed by an
 * UNDO at the very end of a set can leave the max one ahead of the true final
 * score; the authoritative renderings (scoresheet, reports) replay the log.
 */
export async function loadSetScores(
  matchIds: string[],
): Promise<Map<string, { a: number; b: number }[]>> {
  const byMatch = new Map<string, { a: number; b: number }[]>();
  if (matchIds.length === 0) return byMatch;
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
 * All matches across a tenant's competitions, with optional discipline/status
 * filters, date ordering, and pagination — powers the tenant-wide schedule
 * page. "scheduled" groups the pre-live statuses (SCHEDULED/WARMUP/COIN_TOSS).
 * Fetches one row beyond the page so callers know whether a next page exists
 * without a COUNT query.
 */
export async function listTenantMatches(
  tenantId: string,
  opts: TenantMatchFilters & {
    order?: "asc" | "desc";
    page?: number;
    /** Pass false for the CSV export, which wants every matching row. */
    paginate?: boolean;
  } = {},
): Promise<{ rows: TenantMatchRow[]; hasMore: boolean }> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const conds = tenantMatchConditions(tenantId, opts, teamA, teamB);
  const dir = opts.order === "desc" ? desc : asc;
  const page = Math.max(0, opts.page ?? 0);
  const paginate = opts.paginate !== false;
  const q = db
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
      roundName: matches.roundName,
      matchNumber: matches.matchNumber,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(...conds))
    .orderBy(dir(matches.scheduledAt))
    .$dynamic();
  const rows = paginate
    ? await q.limit(MATCHES_PAGE_SIZE + 1).offset(page * MATCHES_PAGE_SIZE)
    : await q;
  return {
    rows: paginate ? rows.slice(0, MATCHES_PAGE_SIZE) : rows,
    hasMore: paginate && rows.length > MATCHES_PAGE_SIZE,
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
      confirmedVia: "SIGNATURES" | "ADMIN" | null;
      confirmedAt: Date | null;
      visId: string | null;
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
      visId: matches.visId,
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
      // Result approval (spec/20) — drives the sign-off / reopen panel.
      confirmedVia: matches.confirmedVia,
      confirmedAt: matches.confirmedAt,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

interface PlayerLiteRow {
  id: string;
  jerseyName: string;
  jerseyNumber: number | null;
  isLibero: boolean;
  isCaptain: boolean;
}

/**
 * Both teams' players (indoor scoreboard rotation, beach service order, and the
 * post-match signature panel — which pre-selects the captain).
 */
export async function loadMatchRosters(matchId: string): Promise<{
  rosterA: PlayerLiteRow[];
  rosterB: PlayerLiteRow[];
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
      jerseyName: people.jerseyName,
      jerseyNumber: players.jerseyNumber,
      isLibero: players.isLibero,
      isCaptain: players.isCaptain,
    })
    .from(players)
    .innerJoin(people, eq(people.id, players.personId))
    .where(inArray(players.teamId, [m.teamAId, m.teamBId]));
  const lite = (teamId: string) =>
    rows
      .filter((r) => r.teamId === teamId)
      .map((r) => ({
        id: r.id,
        jerseyName: r.jerseyName,
        jerseyNumber: r.jerseyNumber,
        isLibero: r.isLibero,
        isCaptain: r.isCaptain,
      }));
  return { rosterA: lite(m.teamAId), rosterB: lite(m.teamBId) };
}
