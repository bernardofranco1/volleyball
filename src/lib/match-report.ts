// Data layer for the match-report PDF (spec/10 §"PDF export"). Pure DB + a
// best-effort engine replay for per-set detail; no PDF concerns here (the route
// owns PDFKit, which is nodejs-only). Beach-only set detail for now; other
// disciplines fall back to the denormalised matches row.
import { aliasedTable, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, events, matches, teams, tenants } from "@/db/schema";
import { loadMatchState } from "@/lib/match-engine";

export interface ReportSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReportEvent {
  sequence: number;
  eventType: string;
  setNumber: number | null;
  scoreAfterA: number | null;
  scoreAfterB: number | null;
  timestamp: Date;
  actor: string;
  notes: string | null;
  /** Raw event payload — the log export reads team/reason/detail from it. */
  payload: Record<string, unknown> | null;
}

export interface MatchReportData {
  matchId: string;
  discipline: string;
  competitionName: string;
  tenantName: string;
  teamAName: string;
  teamBName: string;
  roundName: string | null;
  courtNumber: number | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: string;
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
  sets: ReportSet[];
  events: ReportEvent[];
}

export class MatchReportNotFound extends Error {}

export async function loadMatchReport(
  matchId: string,
): Promise<MatchReportData> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const rows = await db
    .select({
      discipline: matches.discipline,
      status: matches.status,
      competitionName: competitions.name,
      tenantName: tenants.name,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      roundName: matches.roundName,
      courtNumber: matches.courtNumber,
      scheduledAt: matches.scheduledAt,
      startedAt: matches.startedAt,
      finishedAt: matches.finishedAt,
      setsWonA: matches.setsWonA,
      setsWonB: matches.setsWonB,
      winner: matches.winner,
    })
    .from(matches)
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .innerJoin(tenants, eq(tenants.id, matches.tenantId))
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(eq(matches.id, matchId))
    .limit(1);

  const m = rows[0];
  if (!m) throw new MatchReportNotFound(`Match ${matchId} not found`);

  const evRows = await db
    .select({
      sequence: events.sequence,
      eventType: events.eventType,
      setNumber: events.setNumber,
      scoreAfterA: events.scoreAfterA,
      scoreAfterB: events.scoreAfterB,
      timestamp: events.timestamp,
      actor: events.actor,
      notes: events.notes,
      payload: events.payload,
    })
    .from(events)
    .where(eq(events.matchId, matchId))
    .orderBy(asc(events.sequence));

  // Per-set detail from an engine replay (beach only — best effort).
  let sets: ReportSet[] = [];
  try {
    const { state } = await loadMatchState(matchId);
    sets = state.sets.map((s) => ({
      setNumber: s.setNumber,
      scoreA: s.scoreA,
      scoreB: s.scoreB,
      winner: s.winner,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }));
  } catch {
    // Unsupported discipline / replay failure → leave sets empty.
  }

  return {
    matchId,
    discipline: m.discipline,
    competitionName: m.competitionName,
    tenantName: m.tenantName,
    teamAName: m.teamAName,
    teamBName: m.teamBName,
    roundName: m.roundName,
    courtNumber: m.courtNumber,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    status: m.status,
    setsWonA: m.setsWonA,
    setsWonB: m.setsWonB,
    winner: m.winner,
    sets,
    events: evRows as ReportEvent[],
  };
}

// Event types that count as game interruptions / sanctions for the report log.
const INTERRUPTION_TYPES = new Set([
  "TIMEOUT_REQUEST",
  "TIMEOUT_END",
  "TTO_START",
  "TTO_END",
  "MEDICAL_TIMEOUT",
  "MEDICAL_TIMEOUT_END",
  "SIDE_SWITCH",
  "DELAY_WARNING",
  "DELAY_PENALTY",
  "MISCONDUCT_WARNING",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
  "VCS_CHALLENGE",
  "VCS_RESULT",
]);

export function isInterruption(eventType: string): boolean {
  return INTERRUPTION_TYPES.has(eventType);
}
