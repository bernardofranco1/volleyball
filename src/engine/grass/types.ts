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
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
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
    }
  | { type: "RALLY_WON_A" }
  | { type: "RALLY_WON_B" }
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
  | { type: "SERVE_CLOCK_EXPIRE" }
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "UNDO"; targetEventId: string }
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
  medicalTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  lastSequence: number;
  totalMatchSubsA: number;
  totalMatchSubsB: number;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
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

