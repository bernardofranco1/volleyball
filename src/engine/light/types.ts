// Light Volleyball engine — domain types.
// Rules: Official Light Volleyball 2022-2025 (spec/07). 4- or 5-player formats
// (set per competition). Grass-style rotation/lineup/subs + indoor-style
// switching (between sets; deciding set changes ends at 8). No libero/VCS/TTO.
// Adds two scorer-called faults that award the rally to the opponent.

import type { TeamId } from "../types";

export type { TeamId };
export type Side = "LEFT" | "RIGHT";
export type SetNumber = number;

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
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
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

export type LightEventType = LightEventPayload["type"];

export interface LightEvent {
  id: string;
  sequence: number;
  timestamp: string;
  payload: LightEventPayload;
}

export interface MisconductRecord {
  type:
    | "MISCONDUCT_WARNING"
    | "MISCONDUCT_PENALTY"
    | "MISCONDUCT_EXPULSION"
    | "MISCONDUCT_DISQUALIFICATION";
  playerId: string;
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
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
  medicalTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
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

export function activeSet(state: LightMatchState): LightSetState | undefined {
  return state.sets[state.currentSetNumber - 1];
}

export function oppositeTeam(team: TeamId): TeamId {
  return team === "A" ? "B" : "A";
}

export function oppositeSide(side: Side): Side {
  return side === "LEFT" ? "RIGHT" : "LEFT";
}
