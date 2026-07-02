// The reducer "chassis" shared by all four discipline reducers: the event
// cases whose handling is byte-identical (match lifecycle, timeouts, sanctions,
// misconduct, set/match end, no-ops) plus small state helpers.
//
// Structural typing throughout: `reduceCommon` mutates a `CommonMatchState`
// view of the (already-cloned) discipline state, so each discipline's concrete
// state satisfies it without casts. Discipline-specific cases (rallies, VCS,
// libero, lineups, side switches, TTO, …) stay in the discipline reducers.

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";

// ── shared helpers ───────────────────────────────────────────────────────────

export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Replace `outId` with `inId` in a court-positions array (in place). */
export function swapOnCourt(court: string[], outId: string, inId: string): void {
  const idx = court.indexOf(outId);
  if (idx >= 0) court[idx] = inId;
}

// ── structural state shapes the common cases touch ──────────────────────────

export type CommonMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

/** Rally phases every discipline shares (each adds its own on top). */
export type CommonRallyPhase =
  | "IDLE"
  | "BETWEEN_RALLIES"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

export interface CommonSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  delaySanctionsA: number;
  delaySanctionsB: number;
  winner: TeamId | null;
  endedAt: string | null;
}

export interface CommonMatchState<Phase extends string = CommonRallyPhase> {
  status: CommonMatchStatus;
  rallyPhase: Phase;
  currentSetNumber: SetNumber;
  sets: CommonSetState[];
  setsWonA: number;
  setsWonB: number;
  set1FirstServer: TeamId | null;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  medicalTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

// ── the event payloads every discipline handles identically ─────────────────

export type CommonEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | {
      type: "SET_END";
      winner: TeamId;
      scoreA: number;
      scoreB: number;
      setNumber: SetNumber;
    }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
  | { type: "MEDICAL_TIMEOUT"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "SERVE_CLOCK_EXPIRE" }
  | { type: "UNDO"; targetEventId: string }
  | { type: "NOTE"; text: string };

const COMMON_EVENT_TYPES: ReadonlySet<string> = new Set<
  CommonEventPayload["type"]
>([
  "MATCH_CREATED",
  "COIN_TOSS",
  "MATCH_START",
  "REPLAY_POINT",
  "TIMEOUT_REQUEST",
  "TIMEOUT_END",
  "SET_END",
  "MATCH_END",
  "MEDICAL_TIMEOUT",
  "MEDICAL_TIMEOUT_END",
  "DELAY_WARNING",
  "DELAY_PENALTY",
  "MISCONDUCT_WARNING",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
  "SERVE_CLOCK_EXPIRE",
  "UNDO",
  "NOTE",
]);

/** Type guard: is this a payload the shared chassis handles? */
export function isCommonPayload(p: { type: string }): p is CommonEventPayload {
  return COMMON_EVENT_TYPES.has(p.type);
}

/**
 * Apply a common event to the (already-cloned) discipline state, mutating it.
 * The caller has already set `lastSequence`; this handles the rest of the case.
 */
export function reduceCommon<Phase extends string>(
  s: CommonMatchState<Phase | CommonRallyPhase>,
  p: CommonEventPayload,
  timestamp: string,
): void {
  const set = s.sets[s.currentSetNumber - 1];

  switch (p.type) {
    case "MATCH_CREATED":
      s.status = "COIN_TOSS";
      return;

    case "COIN_TOSS":
      s.status = "READY";
      s.set1FirstServer = p.firstServer;
      return;

    case "MATCH_START":
      s.status = "LIVE";
      s.matchStartedAt = timestamp;
      return;

    case "REPLAY_POINT":
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "TIMEOUT_REQUEST":
      if (set) {
        if (p.team === "A") set.timeoutsUsedA += 1;
        else set.timeoutsUsedB += 1;
      }
      s.activeTimeoutTeam = p.team;
      s.rallyPhase = "TIMEOUT_ACTIVE";
      return;

    case "TIMEOUT_END":
      s.activeTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "SET_END": {
      const target = s.sets[p.setNumber - 1];
      if (!target) return;
      // Idempotent: only count the win the first time the set is closed.
      if (!target.winner) {
        if (p.winner === "A") s.setsWonA += 1;
        else s.setsWonB += 1;
      }
      // Imported/synthetic matches with no rally events: trust declared scores.
      if (target.scoreA === 0 && target.scoreB === 0) {
        target.scoreA = p.scoreA;
        target.scoreB = p.scoreB;
      }
      target.winner = p.winner;
      target.endedAt = timestamp;
      s.rallyPhase = "SET_BREAK";
      return;
    }

    case "MATCH_END":
      s.winner = p.winner;
      s.status = "FINISHED";
      s.rallyPhase = "MATCH_OVER";
      return;

    case "MEDICAL_TIMEOUT":
      s.medicalTimeoutTeam = p.team;
      s.rallyPhase = "MEDICAL_TIMEOUT_ACTIVE";
      return;

    case "MEDICAL_TIMEOUT_END":
      s.medicalTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "DELAY_WARNING":
      if (set) {
        if (p.team === "A")
          set.delaySanctionsA = Math.max(1, set.delaySanctionsA);
        else set.delaySanctionsB = Math.max(1, set.delaySanctionsB);
      }
      return;

    case "DELAY_PENALTY":
      if (set) {
        if (p.team === "A") set.delaySanctionsA += 1;
        else set.delaySanctionsB += 1;
      }
      return;

    case "MISCONDUCT_WARNING":
    case "MISCONDUCT_PENALTY":
    case "MISCONDUCT_EXPULSION":
    case "MISCONDUCT_DISQUALIFICATION": {
      const record = {
        type: p.type,
        playerId: p.playerId,
        setNumber: s.currentSetNumber,
        scoreA: set?.scoreA ?? 0,
        scoreB: set?.scoreB ?? 0,
      };
      if (p.team === "A") s.misconductA.push(record);
      else s.misconductB.push(record);
      return;
    }

    case "SERVE_CLOCK_EXPIRE":
    case "UNDO":
    case "NOTE":
      return;
  }
}

// ── substitution (identical in indoor/grass/light; the payload key differs) ──

export interface SubstitutionSetState {
  lineupA: string[];
  lineupB: string[];
  courtPositionsA: string[];
  courtPositionsB: string[];
  subsUsedA: number;
  subsUsedB: number;
  subSlotsA: Record<string, string | null>;
  subSlotsB: Record<string, string | null>;
}

/**
 * Apply a substitution with slot tracking (Rule 15.6 model), mutating state.
 * `counted` is false for exceptional/emergency subs — the discipline reducer
 * derives it from its own payload key (isExceptional vs isEmergency), which
 * stays untouched for replay compatibility.
 */
export function applySubstitution(
  s: { totalMatchSubsA: number; totalMatchSubsB: number },
  set: SubstitutionSetState,
  p: { team: TeamId; outPlayerId: string; inPlayerId: string },
  counted: boolean,
): void {
  const court = p.team === "A" ? set.courtPositionsA : set.courtPositionsB;
  const slots = p.team === "A" ? set.subSlotsA : set.subSlotsB;
  const lineup = p.team === "A" ? set.lineupA : set.lineupB;

  const outIsStarter = lineup.includes(p.outPlayerId);
  if (outIsStarter && slots[p.outPlayerId] === undefined) {
    slots[p.outPlayerId] = p.inPlayerId; // open the slot
  } else {
    // returning starter → exhaust the slot
    const starter = Object.keys(slots).find((k) => slots[k] === p.outPlayerId);
    if (starter) slots[starter] = null;
  }
  swapOnCourt(court, p.outPlayerId, p.inPlayerId);

  if (counted) {
    if (p.team === "A") {
      set.subsUsedA += 1;
      s.totalMatchSubsA += 1;
    } else {
      set.subsUsedB += 1;
      s.totalMatchSubsB += 1;
    }
  }
}
