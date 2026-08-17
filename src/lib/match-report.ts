// Data layer for the match-report PDF (spec/10 §"PDF export"). Pure DB + a
// best-effort engine replay for per-set detail; no PDF concerns here (the route
// owns PDFKit, which is nodejs-only). Beach-only set detail for now; other
// disciplines fall back to the denormalised matches row.
import { aliasedTable, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  events,
  matches,
  people,
  players,
  teams,
  tenantBranding,
  tenants,
} from "@/db/schema";
import { loadMatchState } from "@/lib/match-engine";
import { headCoachName } from "@/lib/people";
import type { StaffFunction } from "@/lib/roster";
import {
  loadOfficials,
  loadSignatures,
  type OfficialRecord,
  type SignatureRecord,
} from "@/lib/match-signatures";

export interface ReportPlayer {
  id: string;
  jerseyName: string;
  jerseyNumber: number | null;
  isCaptain: boolean;
  isLibero: boolean;
  /** Optional split-name/role detail (VSR export, spec/22). */
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  /** Bench officials only (spec/29 F1): the TEAMS-block letter C1/A1-A3/D1/T/P. */
  staffFunction?: StaffFunction | null;
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
  /** Event row id — survivingEvents() resolves UNDO targets against it. */
  id: string;
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
  /** Federation/organiser logo for the official sheet's top-right box. */
  scoresheetLogoUrl: string | null;
  teamAName: string;
  teamBName: string;
  teamACountry: string | null;
  teamBCountry: string | null;
  roundName: string | null;
  matchNumber: number | null;
  /** VIS match number (spec/22 VSR feed), when assigned. */
  visId: string | null;
  phaseName: string | null;
  venue: string | null;
  /** Official scoresheet header (spec/21): venue split + age category. */
  city: string | null;
  country: string | null;
  hall: string | null;
  category: string | null;
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
  /**
   * Head coach per side, for the coach box the official sheets print. Blank
   * until a coach is assigned on the team's roster page (spec/21 gap G4 —
   * there was no coach entity to read before spec/24 §2.5).
   */
  coachA: string | null;
  coachB: string | null;
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
      scoresheetLogoUrl: tenantBranding.scoresheetLogoUrl,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
      teamACountry: teamA.countryCode,
      teamBCountry: teamB.countryCode,
      roundName: matches.roundName,
      matchNumber: matches.matchNumber,
      visId: matches.visId,
      phaseName: matches.phaseName,
      venue: competitions.venue,
      city: competitions.city,
      country: competitions.country,
      hall: competitions.hall,
      category: competitions.category,
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
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, matches.tenantId))
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(eq(matches.id, matchId))
    .limit(1);

  const m = rows[0];
  if (!m) throw new MatchReportNotFound(`Match ${matchId} not found`);

  const evRows = await db
    .select({
      id: events.id,
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
      // Names live on the person only (spec/24 §2.3 contract migration).
      jerseyName: people.jerseyName,
      firstName: people.firstName,
      lastName: people.lastName,
      role: players.role,
      staffFunction: players.staffFunction,
      jerseyNumber: players.jerseyNumber,
      isCaptain: players.isCaptain,
      isLibero: players.isLibero,
    })
    .from(players)
    .innerJoin(people, eq(people.id, players.personId))
    .where(inArray(players.teamId, [m.teamAId, m.teamBId]))
    .orderBy(asc(players.jerseyNumber));
  const rosterOf = (teamId: string): ReportPlayer[] =>
    rosterRows
      .filter((r) => r.teamId === teamId)
      .map((r) => ({
        id: r.id,
        jerseyName: r.jerseyName,
        firstName: r.firstName,
        lastName: r.lastName,
        role: r.role,
        staffFunction: r.staffFunction,
        jerseyNumber: r.jerseyNumber,
        isCaptain: r.isCaptain,
        isLibero: r.isLibero,
      }));
  const rosterA = rosterOf(m.teamAId);
  const rosterB = rosterOf(m.teamBId);

  // Officials + signatures for the APPROVAL block. Retained forever, so a
  // reprint of an old sheet shows exactly who signed it and when.
  const [officials, signatures, coachA, coachB] = await Promise.all([
    loadOfficials(matchId),
    loadSignatures(matchId),
    headCoachName(m.teamAId),
    headCoachName(m.teamBId),
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
    scoresheetLogoUrl: m.scoresheetLogoUrl,
    teamAName: m.teamAName,
    teamBName: m.teamBName,
    teamACountry: m.teamACountry,
    teamBCountry: m.teamBCountry,
    roundName: m.roundName,
    matchNumber: m.matchNumber,
    visId: m.visId,
    phaseName: m.phaseName,
    venue: m.venue,
    city: m.city,
    country: m.country,
    hall: m.hall,
    category: m.category,
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
    // The head coach is a roster row with staffFunction C1 as of spec/29 F1;
    // `headCoachName` (team_staff) stays as the fallback for teams populated
    // through the people pages, which are the only writer of that table.
    coachA: rosterCoach(rosterA) ?? coachA,
    coachB: rosterCoach(rosterB) ?? coachB,
  };
}

/** The rostered head coach's name, or null when none is registered. */
function rosterCoach(roster: ReportPlayer[]): string | null {
  const c1 = roster.find(
    (p) => p.role === "STAFF" && p.staffFunction === "C1",
  );
  return c1?.jerseyName ?? null;
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
  "IMPROPER_REQUEST",
]);

export function isInterruption(eventType: string): boolean {
  return INTERRUPTION_TYPES.has(eventType);
}
