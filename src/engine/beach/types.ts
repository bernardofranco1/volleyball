// Beach volleyball engine — domain types.
// Pure TypeScript: no framework, no I/O. Rules source: FIVB Beach 2025-2028.
//
// State is config-driven: scoring targets, side-switch intervals, TTO trigger,
// timeout/challenge counts all come from a resolved `TournamentConfig`
// (src/engine/config.ts), so the same reducer serves any beach ruleset.

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";

export type { MisconductRecord, SetNumber, Side, TeamId } from "../types";
export { activeSet, oppositeSide, oppositeTeam } from "../types";
/** Beach: each team has two players who serve in alternation. */
export type PlayerNumber = 1 | 2;

export type BeachMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

export type RallyPhase =
  | "IDLE"
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "TTO_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

// ── Event payloads ───────────────────────────────────────────────────────────

export type BeachEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | { type: "RALLY_START" }
  | {
      type: "SET_START";
      setNumber: SetNumber;
      firstServer: TeamId;
      teamAStartSide: Side;
    }
  | { type: "RALLY_WON_A" }
  | { type: "RALLY_WON_B" }
  | { type: "REPLAY_POINT" }
  // Declares which roster player serves first for `team` this set (FIVB rule
  // 12.2: each team's service order is chosen per set). Binds the abstract
  // serve-order slots (player 1/2) to a real player; re-submittable to correct
  // a mistaken declaration.
  | { type: "SERVICE_ORDER"; team: TeamId; firstServerPlayerId: string }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | { type: "TTO_START" } // auto-emitted by the engine
  | { type: "TTO_END" }
  | { type: "SIDE_SWITCH"; newTeamASide: Side } // auto-emitted
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

export type BeachEventType = BeachEventPayload["type"];

/** A persisted event. The engine only reads `id`, `sequence`, `timestamp`, `payload`. */
export interface BeachEvent {
  id: string;
  sequence: number;
  timestamp: string; // ISO 8601
  payload: BeachEventPayload;
}

// ── State shape ──────────────────────────────────────────────────────────────

export interface BeachSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side; // current side (flips on SIDE_SWITCH)
  firstServer: TeamId;
  currentServer: TeamId;
  // Which player currently holds serve for each team. `null` = that team has
  // not yet served in this set; their first serve is always player 1, and on
  // every subsequent side-out won the server alternates.
  serverPlayerA: PlayerNumber | null;
  serverPlayerB: PlayerNumber | null;
  // Identity of each team's "player 1" (first server) this set, as declared
  // via SERVICE_ORDER. null = not declared — the UI then falls back to the
  // abstract slot labels. Player 2 is the pair's other player.
  firstServerPlayerIdA: string | null;
  firstServerPlayerIdB: string | null;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  ttoFired: boolean;

  // Video Challenge System
  challengesRemainingA: number;
  challengesRemainingB: number;

  // Delay sanctions: 0 = none, 1 = warning, 2+ = penalty
  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface BeachMatchState {
  matchId: string;
  status: BeachMatchStatus;
  rallyPhase: RallyPhase;
  currentSetNumber: SetNumber;
  sets: BeachSetState[];
  setsWonA: number;
  setsWonB: number;
  set1FirstServer: TeamId | null;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  /** Event timestamp of the active team time-out (drives countdowns). */
  activeTimeoutStartedAt?: string | null;
  /** Event timestamp when the current set break began (drives countdowns). */
  setBreakStartedAt?: string | null;
  ttoActive: boolean;
  medicalTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  lastSequence: number;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

/** Serve-order slot (1 | 2) of the player expected to serve next, or null pre-set. */
export function currentServerSlot(set: BeachSetState): PlayerNumber | null {
  return set.currentServer === "A" ? set.serverPlayerA : set.serverPlayerB;
}

/** The declared first-server playerId for `team` this set, or null. */
export function firstServerPlayerId(
  set: BeachSetState,
  team: TeamId,
): string | null {
  return team === "A" ? set.firstServerPlayerIdA : set.firstServerPlayerIdB;
}

// ── Construction helpers ─────────────────────────────────────────────────────

export function initialBeachState(matchId: string): BeachMatchState {
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
    ttoActive: false,
    medicalTimeoutTeam: null,
    matchStartedAt: null,
    lastSequence: 0,
    misconductA: [],
    misconductB: [],
  };
}

