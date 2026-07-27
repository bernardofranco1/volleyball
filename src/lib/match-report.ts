// Data layer for the match-report PDF (spec/10 §"PDF export"). Pure DB + a
// best-effort engine replay for per-set detail; no PDF concerns here (the route
// owns PDFKit, which is nodejs-only). Beach-only set detail for now; other
// disciplines fall back to the denormalised matches row.
import { aliasedTable, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { competitions, events, matches, players, teams, tenants } from "@/db/schema";
import { loadMatchState } from "@/lib/match-engine";
import {
  loadOfficials,
  loadSignatures,
  type OfficialRecord,
  type SignatureRecord,
} from "@/lib/match-signatures";

export interface ReportPlayer {
  id: string;
  fullName: string;
  jerseyNumber: number | null;
  isCaptain: boolean;
  isLibero: boolean;
}

export interface ReportSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Team time-outs used in this set (official sheet's RESULTS block). */
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  /** Beach only: the automatic technical time-out fired in this set. */
  ttoFired: boolean;
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

/** APPROVAL block of the official scoresheet (spec/20). */
export interface ReportApproval {
  /** How the result became official, or null while it is still pending. */
  confirmedVia: "SIGNATURES" | "ADMIN" | null;
  confirmedAt: Date | null;
  officials: OfficialRecord[];
  signatures: SignatureRecord[];
}

export interface MatchReportData {
  matchId: string;
  discipline: string;
  competitionName: string;
  tenantName: string;
  teamAName: string;
  teamBName: string;
  roundName: string | null;
  matchNumber: number | null;
  phaseName: string | null;
  venue: string | null;
  gender: string | null;
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
  approval: ReportApproval;
  rosterA: ReportPlayer[];
  rosterB: ReportPlayer[];
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
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      roundName: matches.roundName,
      matchNumber: matches.matchNumber,
      phaseName: matches.phaseName,
      venue: competitions.venue,
      gender: competitions.gender,
      courtNumber: matches.courtNumber,
      scheduledAt: matches.scheduledAt,
      startedAt: matches.startedAt,
      finishedAt: matches.finishedAt,
      confirmedAt: matches.confirmedAt,
      confirmedVia: matches.confirmedVia,
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

  // Rosters for the TEAMS block of the official sheet — jersey, name, captain.
  const rosterRows = await db
    .select({
      id: players.id,
      teamId: players.teamId,
      fullName: players.fullName,
      jerseyNumber: players.jerseyNumber,
      isCaptain: players.isCaptain,
      isLibero: players.isLibero,
    })
    .from(players)
    .where(inArray(players.teamId, [m.teamAId, m.teamBId]))
    .orderBy(asc(players.jerseyNumber));
  const rosterOf = (teamId: string): ReportPlayer[] =>
    rosterRows
      .filter((r) => r.teamId === teamId)
      .map((r) => ({
        id: r.id,
        fullName: r.fullName,
        jerseyNumber: r.jerseyNumber,
        isCaptain: r.isCaptain,
        isLibero: r.isLibero,
      }));
  const rosterA = rosterOf(m.teamAId);
  const rosterB = rosterOf(m.teamBId);

  // Officials + signatures for the APPROVAL block. Retained forever, so a
  // reprint of an old sheet shows exactly who signed it and when.
  const [officials, signatures] = await Promise.all([
    loadOfficials(matchId),
    loadSignatures(matchId),
  ]);

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
      timeoutsUsedA: s.timeoutsUsedA ?? 0,
      timeoutsUsedB: s.timeoutsUsedB ?? 0,
      ttoFired: (s as { ttoFired?: boolean }).ttoFired ?? false,
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
    matchNumber: m.matchNumber,
    phaseName: m.phaseName,
    venue: m.venue,
    gender: m.gender,
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
    approval: {
      confirmedVia: m.confirmedVia,
      confirmedAt: m.confirmedAt,
      officials,
      signatures,
    },
    rosterA,
    rosterB,
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
