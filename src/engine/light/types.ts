// Light Volleyball engine — domain types.
// Rules: Official Light Volleyball 2022-2025 (spec/07). 4- or 5-player formats
// (set per competition). Grass-style rotation/lineup/subs + indoor-style
// switching (between sets; deciding set changes ends at 8). No libero/VCS/TTO.
// Adds two scorer-called faults that award the rally to the opponent.

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";

export type { MisconductRecord, SetNumber, Side, TeamId } from "../types";
export { activeSet, oppositeSide, oppositeTeam } from "../types";

export type LightMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

export type LightRallyPhase =
  | "IDLE"
  | "LINEUP_PENDING"
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

export type LightEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side; tossWinner?: TeamId }
  | { type: "MATCH_START" }
  | {
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
  | { type: "SIDE_SWITCH"; newTeamASide: Side } // auto-emitted (decider @ 8)
  | {
      type: "SUBSTITUTION";
      team: TeamId;
      outPlayerId: string;
      inPlayerId: string;
      isEmergency?: boolean;
    }
  // Scorer-called faults: the named team committed it → point + serve to opponent.
  | { type: "JUMP_SERVE_FOOT_FAULT"; team: TeamId }
  | { type: "ATTACK_ARC_FAULT"; team: TeamId }
  | {
      type: "SET_END";
      winner: TeamId;
      scoreA: number;
      scoreB: number;
      setNumber: SetNumber;
    }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
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
  | { type: "MEDICAL_TIMEOUT"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "UNDO"; targetEventId: string; scope?: "single" | "point" }
  | { type: "NOTE"; text: string };

export type LightEventType = LightEventPayload["type"];

export interface LightEvent {
  id: string;
  sequence: number;
  timestamp: string;
  payload: LightEventPayload;
}

export interface LightSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  lineupA: string[];
  lineupB: string[];
  courtPositionsA: string[];
  courtPositionsB: string[];
  lineupConfirmed: boolean;
  rotationIndexA: number;
  rotationIndexB: number;
  lastRotA: number | null;
  lastRotB: number | null;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;
  subSlotsA: Record<string, string | null>;
  subSlotsB: Record<string, string | null>;

  decidingSwitchDone: boolean;
  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LightMatchState {
  matchId: string;
  playersPerSide: number; // 4 or 5 (mirrors config; updated on each reduce)
  status: LightMatchStatus;
  rallyPhase: LightRallyPhase;
  currentSetNumber: SetNumber;
  sets: LightSetState[];
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
}

export function initialLightState(matchId: string): LightMatchState {
  return {
    matchId,
    playersPerSide: 4,
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

