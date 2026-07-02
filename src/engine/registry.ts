// Discipline-agnostic engine adapter. The server orchestration (match-engine.ts)
// and the optimistic client both talk to an engine through this uniform shape, so
// adding a discipline means registering one adapter — not editing the
// orchestration.
//
// Each discipline implements a fully-typed `Engine<S, P>` with NO internal casts.
// The registry erases them to `EngineAdapter` (over `CommonMatchState`) with a
// single boundary cast per discipline — the irreducible spot, since `Engine` is
// invariant in its state type and the orchestration is generic over the union.

import type { TournamentConfig } from "./config";
import type { Discipline, TeamId } from "./types";

import {
  appendBeachEvent,
  reduce as beachReduce,
  replayEvents as beachReplay,
} from "./beach/reducer";
import {
  type BeachEventPayload,
  type BeachMatchState,
  activeSet as beachActiveSet,
} from "./beach/types";
import {
  appendIndoorEvent,
  reduce as indoorReduce,
  replayEvents as indoorReplay,
} from "./indoor/reducer";
import {
  type IndoorEventPayload,
  type IndoorMatchState,
  activeSet as indoorActiveSet,
} from "./indoor/types";
import {
  appendGrassEvent,
  reduce as grassReduce,
  replayEvents as grassReplay,
} from "./grass/reducer";
import {
  type GrassEventPayload,
  type GrassMatchState,
  activeSet as grassActiveSet,
} from "./grass/types";
import {
  appendLightEvent,
  reduce as lightReduce,
  replayEvents as lightReplay,
} from "./light/reducer";
import {
  type LightEventPayload,
  type LightMatchState,
  activeSet as lightActiveSet,
} from "./light/types";

/** The subset of match state the persistence/broadcast layer relies on. */
export interface CommonMatchState {
  matchId: string;
  status: "SETUP" | "COIN_TOSS" | "READY" | "LIVE" | "FINISHED";
  rallyPhase: string;
  currentSetNumber: number;
  setsWonA: number;
  setsWonB: number;
  winner: TeamId | null;
  matchStartedAt: string | null;
  lastSequence: number;
}

export type BasePayload = { type: string } & Record<string, unknown>;

export interface EngineEvent<P = BasePayload> {
  id: string;
  sequence: number;
  timestamp: string;
  payload: P;
}

export interface DenormCols {
  scoreAfterA: number | null;
  scoreAfterB: number | null;
  setNumber: number | null;
  serverTeam: TeamId | null;
  serverPlayerNumber: number | null;
  sidesAfter: { teamA: string; teamB: string } | null;
}

export type MatchRowStatus =
  | "SCHEDULED"
  | "WARMUP"
  | "COIN_TOSS"
  | "LIVE"
  // Row-only: the engine reports FINISHED, but a scorer's final point parks the
  // match here until a manager confirms it (spec/17). matchStatusOf never emits it.
  | "PENDING_CONFIRMATION"
  | "FINISHED"
  | "ABANDONED";

export type AppendResult<S, P> =
  | { ok: false; reason: string }
  | { ok: true; newEvents: EngineEvent<P>[]; state: S };

export interface AppendOpts {
  nextSequence: number;
  timestamp: string;
  makeId: (sequence: number) => string;
}

/** A discipline's pure engine, fully typed over its state `S` and payload `P`. */
export interface Engine<S extends CommonMatchState, P extends { type: string }> {
  replay(matchId: string, events: EngineEvent<P>[], config: TournamentConfig): S;
  reduce(state: S, event: EngineEvent<P>, config: TournamentConfig): S;
  append(
    prev: S,
    payload: P,
    config: TournamentConfig,
    opts: AppendOpts,
  ): AppendResult<S, P>;
  denormalize(state: S): DenormCols;
  matchStatusOf(state: S): MatchRowStatus;
}

/** Erased engine used by the orchestration (state as the common shape). */
export type EngineAdapter = Engine<CommonMatchState, BasePayload>;

function rowStatusOf(status: CommonMatchState["status"]): MatchRowStatus {
  switch (status) {
    case "LIVE":
      return "LIVE";
    case "FINISHED":
      return "FINISHED";
    case "COIN_TOSS":
    case "READY":
      return "COIN_TOSS";
    default:
      return "SCHEDULED";
  }
}

function sidesOf(teamASide: string): { teamA: string; teamB: string } {
  return { teamA: teamASide, teamB: teamASide === "LEFT" ? "RIGHT" : "LEFT" };
}

// ── Concrete engines (no casts; the imported functions already match) ─────────

const beachEngine: Engine<BeachMatchState, BeachEventPayload> = {
  replay: beachReplay,
  reduce: beachReduce,
  append: appendBeachEvent,
  matchStatusOf: (s) => rowStatusOf(s.status),
  denormalize: (state) => {
    const set = beachActiveSet(state);
    const serverTeam = set?.currentServer ?? null;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: state.currentSetNumber,
      serverTeam,
      serverPlayerNumber:
        set == null ? null : serverTeam === "A" ? set.serverPlayerA : set.serverPlayerB,
      sidesAfter: set ? sidesOf(set.teamASide) : null,
    };
  },
};

const indoorEngine: Engine<IndoorMatchState, IndoorEventPayload> = {
  replay: indoorReplay,
  reduce: indoorReduce,
  append: appendIndoorEvent,
  matchStatusOf: (s) => rowStatusOf(s.status),
  denormalize: (state) => {
    const set = indoorActiveSet(state);
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: state.currentSetNumber,
      serverTeam: set?.currentServer ?? null,
      // Indoor servers are identified by player id, not a 1/2 number.
      serverPlayerNumber: null,
      sidesAfter: set ? sidesOf(set.teamASide) : null,
    };
  },
};

const grassEngine: Engine<GrassMatchState, GrassEventPayload> = {
  replay: grassReplay,
  reduce: grassReduce,
  append: appendGrassEvent,
  matchStatusOf: (s) => rowStatusOf(s.status),
  denormalize: (state) => {
    const set = grassActiveSet(state);
    const serverTeam = set?.currentServer ?? null;
    const lastRot =
      set == null ? null : serverTeam === "A" ? set.lastRotA : set.lastRotB;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: state.currentSetNumber,
      serverTeam,
      serverPlayerNumber: lastRot == null ? null : lastRot + 1,
      sidesAfter: set ? sidesOf(set.teamASide) : null,
    };
  },
};

const lightEngine: Engine<LightMatchState, LightEventPayload> = {
  replay: lightReplay,
  reduce: lightReduce,
  append: appendLightEvent,
  matchStatusOf: (s) => rowStatusOf(s.status),
  denormalize: (state) => {
    const set = lightActiveSet(state);
    const serverTeam = set?.currentServer ?? null;
    const lastRot =
      set == null ? null : serverTeam === "A" ? set.lastRotA : set.lastRotB;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: state.currentSetNumber,
      serverTeam,
      serverPlayerNumber: lastRot == null ? null : lastRot + 1,
      sidesAfter: set ? sidesOf(set.teamASide) : null,
    };
  },
};

// One boundary cast per discipline (Engine is invariant in S; the orchestration
// is generic over the union of states).
const REGISTRY: Partial<Record<Discipline, EngineAdapter>> = {
  BEACH: beachEngine as unknown as EngineAdapter,
  INDOOR: indoorEngine as unknown as EngineAdapter,
  GRASS: grassEngine as unknown as EngineAdapter,
  LIGHT: lightEngine as unknown as EngineAdapter,
};

/** The engine adapter for a discipline, or null if not yet supported. */
export function getEngine(discipline: Discipline): EngineAdapter | null {
  return REGISTRY[discipline] ?? null;
}

export function isDisciplineSupported(discipline: Discipline): boolean {
  return REGISTRY[discipline] != null;
}
