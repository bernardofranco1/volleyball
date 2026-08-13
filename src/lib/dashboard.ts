// Read side for the operational dashboard.
//
// The old dashboard rendered three navigation cards and zero rows of data — it
// duplicated the nav menu. These queries answer the questions someone actually
// opens the console for: what is live, what is on today, what is waiting on me,
// and what changed recently. Every query is tenant-scoped.
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";
import { db } from "@/db";
import { competitions, matches, teams } from "@/db/schema";

export interface DashboardMatch {
  id: string;
  competitionId: string;
  competitionName: string;
  competitionColor: string | null;
  discipline: string;
  status: string;
  teamAName: string;
  teamBName: string;
  setsWonA: number;
  setsWonB: number;
  courtNumber: number | null;
  roundName: string | null;
  scheduledAt: Date | null;
}

export interface CompetitionProgress {
  id: string;
  name: string;
  color: string | null;
  played: number;
  total: number;
}

export interface DashboardData {
  live: DashboardMatch[];
  today: DashboardMatch[];
  pending: DashboardMatch[];
  drafts: { id: string; name: string; matchCount: number }[];
  season: CompetitionProgress | null;
}

const MATCH_FIELDS = {
  id: matches.id,
  competitionId: matches.competitionId,
  competitionName: competitions.name,
  competitionColor: competitions.color,
  discipline: matches.discipline,
  status: matches.status,
  setsWonA: matches.setsWonA,
  setsWonB: matches.setsWonB,
  courtNumber: matches.courtNumber,
  roundName: matches.roundName,
  scheduledAt: matches.scheduledAt,
};

/** Shared select+joins; each caller adds its own tenant-scoped where clause. */
function matchQuery() {
  const teamA = aliasedTable(teams, "dash_team_a");
  const teamB = aliasedTable(teams, "dash_team_b");
  return db
    .select({
      ...MATCH_FIELDS,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
    })
    .from(matches)
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .$dynamic();
}

/**
 * `today` is the current UTC day. The server has no access to the viewer's
 * timezone, and inventing one from the tenant's country would be wrong for the
 * touring officials this is aimed at — the times themselves render in the
 * viewer's zone via <LocalTime>, so a match near midnight can land in the
 * neighbouring bucket. That is a smaller lie than a server-guessed timezone.
 */
export async function loadDashboard(
  tenantId: string,
  opts: { includeAdmin: boolean },
): Promise<DashboardData> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [live, today, pending, drafts, season] = await Promise.all([
    matchQuery()
      .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "LIVE")))
      .orderBy(asc(matches.scheduledAt))
      .limit(12),

    matchQuery()
      .where(
        and(
          eq(matches.tenantId, tenantId),
          inArray(matches.status, ["SCHEDULED", "WARMUP", "COIN_TOSS"]),
          gte(matches.scheduledAt, dayStart),
          lt(matches.scheduledAt, dayEnd),
        ),
      )
      .orderBy(asc(matches.scheduledAt))
      .limit(12),

    opts.includeAdmin
      ? matchQuery()
          .where(
            and(
              eq(matches.tenantId, tenantId),
              eq(matches.status, "PENDING_CONFIRMATION"),
            ),
          )
          .orderBy(desc(matches.scheduledAt))
          .limit(6)
      : Promise.resolve([]),

    // Draft competitions with nothing scheduled yet: the most common "you
    // started something and stopped" state, and invisible until now.
    opts.includeAdmin
      ? db
          .select({
            id: competitions.id,
            name: competitions.name,
            matchCount: count(matches.id),
          })
          .from(competitions)
          .leftJoin(matches, eq(matches.competitionId, competitions.id))
          .where(
            and(
              eq(competitions.tenantId, tenantId),
              eq(competitions.status, "DRAFT"),
            ),
          )
          .groupBy(competitions.id, competitions.name)
          .limit(5)
      : Promise.resolve([]),

    seasonProgress(tenantId),
  ]);

  return {
    live: live as DashboardMatch[],
    today: today as DashboardMatch[],
    pending: pending as DashboardMatch[],
    drafts,
    season,
  };
}

/**
 * Played-vs-total for the tenant's busiest active competition — the "how far
 * through the season are we" tile. Picked by total match count rather than by
 * date so a one-off cup with two matches doesn't outrank the league.
 */
async function seasonProgress(
  tenantId: string,
): Promise<CompetitionProgress | null> {
  const rows = await db
    .select({
      id: competitions.id,
      name: competitions.name,
      color: competitions.color,
      total: count(matches.id),
      played: sql<number>`count(*) filter (where ${matches.status} in ('FINISHED','ABANDONED'))`,
    })
    .from(competitions)
    .innerJoin(matches, eq(matches.competitionId, competitions.id))
    .where(
      and(eq(competitions.tenantId, tenantId), eq(competitions.status, "ACTIVE")),
    )
    .groupBy(competitions.id, competitions.name, competitions.color)
    .orderBy(desc(count(matches.id)))
    .limit(1);
  const r = rows[0];
  return r ? { ...r, played: Number(r.played), total: Number(r.total) } : null;
}
