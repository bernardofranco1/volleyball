// Grass volleyball engine — domain types.
// Rules: FIVB Beach base adapted for 3v3 / 4v4 on grass (see spec/06). It keeps
// the beach scoring + side-switch model and adds indoor-style rotation, lineup
// confirmation, and substitutions (no libero, no VCS, no TTO by default).

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";

export type { MisconductRecord, SetNumber, Side, TeamId } from "../types";
export { activeSet, oppositeSide, oppositeTeam } from "../types";

export type GrassMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

export type GrassRallyPhase =
  | "IDLE"
  | "LINEUP_PENDING" // awaiting the (both-teams) LINEUP_CONFIRMED
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

// ── Event payloads ───────────────────────────────────────────────────────────

export type GrassEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side; tossWinner?: TeamId }
  | { type: "MATCH_START" }
  | {
      // One event confirms both teams' lineups (rotation order, pos 1 first).
      type: "LINEUP_CONFIRMED";
      setNumber: SetNumber;
      teamAPlayerIds: string[];
      teamBPlayerIds: string[];
    }
  | {
      type: "SET_START";
      setNumber: SetNumber;
      firstServer: TeamId;
      teamAStartSide: Side;
      /** Deciding-set re-toss winner (spec/21) — printed on the scoresheet. */
      tossWinner?: TeamId;
    }
  // Marks the first referee's whistle / service — anchors the rally's real
  // start time for the VSR feed and timing exports (spec/22). Optional: a
  // rally scored without it falls back to approximated timing.
  | { type: "RALLY_START" }
  // `causedBy` (spec/29 F14): the id of the sanction event this point came
  // from, when the scorer awarded it through the guided flow. Optional and
  // purely informational — the reducer ignores it, so old logs replay
  // identically and nothing downstream has to know about it. It exists so the
  // sheet can print a penalty and its point as one fact instead of two
  // coincidental ones.
  | { type: "RALLY_WON_A"; causedBy?: string }
  | { type: "RALLY_WON_B"; causedBy?: string }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | { type: "SIDE_SWITCH"; newTeamASide: Side } // auto-emitted
  | {
      type: "SUBSTITUTION";
      team: TeamId;
      outPlayerId: string;
      inPlayerId: string;
      isEmergency?: boolean; // doesn't count toward the per-set limit
    }
  | {
      type: "SET_END"; // auto-emitted
      winner: TeamId;
      scoreA: number;
      scoreB: number;
      setNumber: SetNumber;
    }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number } // auto-emitted
  | { type: "FORFEIT"; team: TeamId; reason: "FORFEIT" | "RETIREMENT" }
  // One set awarded to the opponent — incomplete team (spec/29 F14). The match
  // continues; FORFEIT above ends it.
  | { type: "SET_DEFAULT"; team: TeamId; reason: "INCOMPLETE_TEAM" | "OTHER" }
  | { type: "SERVE_CLOCK_EXPIRE" }
  | { type: "IMPROPER_REQUEST"; team: TeamId }
  // Positional faults, recorded as markers (spec/29 F13) — the point they
  // award is an ordinary rally event with `causedBy`.
  | { type: "ROTATION_FAULT"; team: TeamId; note?: string }
  | { type: "SERVICE_ORDER_FAULT"; team: TeamId; note?: string }
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  // `playerId` (spec/29 F11): who is treated — printed on the sheet.
  | { type: "MEDICAL_TIMEOUT"; team: TeamId; playerId?: string }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "UNDO"; targetEventId: string; scope?: "single" | "point" }
  | { type: "NOTE"; text: string };

export type GrassEventType = GrassEventPayload["type"];

export interface GrassEvent {
  id: string;
  sequence: number;
  timestamp: string;
  payload: GrassEventPayload;
}

// ── State shape ──────────────────────────────────────────────────────────────

export interface GrassSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  // Rotation (3 or 4 players). lineup = immutable starting order; courtPositions
  // = current order after subs. The server is courtPositions[lastRot].
  lineupA: string[];
  lineupB: string[];
  courtPositionsA: string[];
  courtPositionsB: string[];
  lineupConfirmed: boolean;
  rotationIndexA: number;
  rotationIndexB: number;
  lastRotA: number | null; // rotation index of A's most recent serve (null = none yet)
  lastRotB: number | null;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;
  subSlotsA: Record<string, string | null>; // starter → current sub (null = exhausted)
  subSlotsB: Record<string, string | null>;

  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface GrassMatchState {
  matchId: string;
  status: GrassMatchStatus;
  rallyPhase: GrassRallyPhase;
  currentSetNumber: SetNumber;
  sets: GrassSetState[];
  setsWonA: number;
  setsWonB: number;
  set1FirstServer: TeamId | null;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  /** Event timestamp of the active team time-out (drives countdowns). */
  activeTimeoutStartedAt?: string | null;
  /** Event timestamp when the current set break began (drives countdowns). */
  setBreakStartedAt?: string | null;
  medicalTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  /** Lineup declared before the next set exists (spec/21 flow fix): stashed
   *  here and applied by SET_START. Optional — old snapshots lack it. */
  pendingLineup?: {
    teamAPlayerIds: string[];
    teamBPlayerIds: string[];
  } | null;
  lastSequence: number;
  totalMatchSubsA: number;
  totalMatchSubsB: number;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
  /** Medical recoveries per roster-row id (spec/29 F11); absent on old snapshots. */
  recoveriesByPlayer?: Record<string, number>;
}

// ── Construction & helpers ─────────────────────────────────────────────────────

export function initialGrassState(matchId: string): GrassMatchState {
  return {
    matchId,
    status: "SETUP",
    rallyPhase: "IDLE",
    currentSetNumber: 1,
    sets: [],
    setsWonA: 0,
    setsWonB: 0,
    set1FirstServer: null,
    winner: null,
    activeTimeoutTeam: null,
    medicalTimeoutTeam: null,
    matchStartedAt: null,
    lastSequence: 0,
    totalMatchSubsA: 0,
    totalMatchSubsB: 0,
    misconductA: [],
    misconductB: [],
  };
}

