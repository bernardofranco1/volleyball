// Indoor volleyball engine — domain types.
// Pure TypeScript: no framework, no I/O. Rules source: FIVB Official Volleyball
// Rules 2025-2028 (see spec/05-ENGINE-INDOOR.md). Like the beach engine, state is
// rebuilt by replaying the append-only event log and is fully config-driven.

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";

export type { MisconductRecord, SetNumber, Side, TeamId } from "../types";
export { activeSet, oppositeSide, oppositeTeam } from "../types";

export type IndoorMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

export type IndoorRallyPhase =
  | "IDLE"
  | "LINEUP_PENDING" // awaiting LINEUP_CONFIRMED from both teams
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "VCS_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

// ── Event payloads ───────────────────────────────────────────────────────────

export type IndoorEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | {
      type: "LINEUP_CONFIRMED";
      team: TeamId;
      setNumber: SetNumber;
      // Player IDs in rotation order: position 1 first (server), then 2..6.
      playerIds: string[];
      liberoId: string | null;
      secondLiberoId: string | null;
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
  | { type: "SIDE_SWITCH"; newTeamASide: Side } // auto-emitted (decider @ 8)
  | {
      type: "SUBSTITUTION";
      team: TeamId;
      outPlayerId: string;
      inPlayerId: string;
      isExceptional?: boolean; // injury sub, doesn't count toward limit
    }
  | {
      type: "LIBERO_REPLACEMENT";
      team: TeamId;
      liberoId: string;
      direction: "IN" | "OUT";
      outPlayerId: string; // player the libero replaces (IN) / who returns (OUT)
    }
  | { type: "LIBERO_REDESIGNATION"; team: TeamId; newLiberoId: string }
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
  | { type: "VCS_CHALLENGE"; team: TeamId }
  | { type: "VCS_RESULT"; upheld: boolean; team: TeamId }
  | { type: "UNDO"; targetEventId: string }
  | { type: "NOTE"; text: string };

export type IndoorEventType = IndoorEventPayload["type"];

export interface IndoorEvent {
  id: string;
  sequence: number;
  timestamp: string; // ISO 8601
  payload: IndoorEventPayload;
}

// ── State shape ──────────────────────────────────────────────────────────────

export interface LiberoState {
  liberoIdA: string | null;
  liberoIdB: string | null;
  secondLiberoIdA: string | null;
  secondLiberoIdB: string | null;
  // Back-row player currently replaced by the libero (null = libero off court).
  liberoReplacingA: string | null;
  liberoReplacingB: string | null;
  liberoOnCourtA: boolean;
  liberoOnCourtB: boolean;
  // ralliesPlayed value at the team's last libero replacement (rally-between rule).
  lastLiberoRallyA: number;
  lastLiberoRallyB: number;
}

export interface VCSState {
  challengesRemainingA: number;
  challengesRemainingB: number;
  activeChallenge: { team: TeamId; requestSeq: number } | null;
}

export interface IndoorSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  // Rotation index (0-5) per team; advances by 1 each time that team earns serve.
  rotationIndexA: number;
  rotationIndexB: number;

  // Starting lineup (immutable for the set) [pos1..pos6] and live court positions.
  lineupA: string[];
  lineupB: string[];
  lineupConfirmedA: boolean;
  lineupConfirmedB: boolean;
  courtPositionsA: string[]; // courtPositionsA[i] = player in position i+1
  courtPositionsB: string[];

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;
  // Sub slots: starterId → current substitute on court for that slot (or null).
  subSlotsA: Record<string, string | null>;
  subSlotsB: Record<string, string | null>;

  libero: LiberoState;
  vcs: VCSState;

  // Completed rallies in this set (drives the libero rally-between rule).
  ralliesPlayed: number;
  // Deciding-set court change (Rule 18.2) already emitted this set?
  decidingSwitchDone: boolean;

  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface IndoorMatchState {
  matchId: string;
  status: IndoorMatchStatus;
  rallyPhase: IndoorRallyPhase;
  currentSetNumber: SetNumber;
  sets: IndoorSetState[];
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
  lastSequence: number;
  totalMatchSubsA: number;
  totalMatchSubsB: number;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

// ── Construction & helpers ─────────────────────────────────────────────────────

export function initialIndoorState(matchId: string): IndoorMatchState {
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


// Back-row court positions are 1, 5, 6 → array indices 0, 4, 5 (Rule 7.4).
const BACK_ROW_INDICES = new Set([0, 4, 5]);
export function isBackRowIndex(positionIndex: number): boolean {
  return BACK_ROW_INDICES.has(positionIndex);
}

/** Clockwise rotation: pos2→pos1, …, pos1→pos6 (a left-shift of the array). */
export function rotateClockwise<T>(positions: T[]): T[] {
  if (positions.length === 0) return positions;
  return [...positions.slice(1), positions[0]];
}
