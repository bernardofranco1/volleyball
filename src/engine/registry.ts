// Discipline-agnostic engine adapter. The server orchestration (match-engine.ts)
// and the optimistic client both talk to an engine through this uniform shape,
// so adding a discipline means registering one adapter — not editing the
// orchestration. Beach and indoor are registered today; grass/light land later.
//
// State is passed around as `CommonMatchState` (the fields the orchestration
// reads). Each adapter casts to its concrete state internally — safe because a
// state only ever flows back to the adapter that produced it.

import type { TournamentConfig } from "./config";
import type { Discipline, TeamId } from "./types";

import {
  appendBeachEvent,
  reduce as beachReduce,
  replayEvents as beachReplay,
} from "./beach/reducer";
import {
  type BeachMatchState,
  activeSet as beachActiveSet,
} from "./beach/types";
import {
  appendIndoorEvent,
  reduce as indoorReduce,
  replayEvents as indoorReplay,
} from "./indoor/reducer";
import {
  type IndoorMatchState,
  activeSet as indoorActiveSet,
} from "./indoor/types";
import {
  appendGrassEvent,
  reduce as grassReduce,
  replayEvents as grassReplay,
} from "./grass/reducer";
import {
  type GrassMatchState,
  activeSet as grassActiveSet,
} from "./grass/types";
import {
  appendLightEvent,
  reduce as lightReduce,
  replayEvents as lightReplay,
} from "./light/reducer";
import {
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

export interface EngineEvent {
  id: string;
  sequence: number;
  timestamp: string;
  payload: { type: string } & Record<string, unknown>;
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
  | "FINISHED"
  | "ABANDONED";

export type AppendResult =
  | { ok: false; reason: string }
  | { ok: true; newEvents: EngineEvent[]; state: CommonMatchState };

export interface AppendOpts {
  nextSequence: number;
  timestamp: string;
  makeId: (sequence: number) => string;
}

export interface EngineAdapter {
  replay(
    matchId: string,
    events: EngineEvent[],
    config: TournamentConfig,
  ): CommonMatchState;
  reduce(
    state: CommonMatchState,
    event: EngineEvent,
    config: TournamentConfig,
  ): CommonMatchState;
  append(
    prev: CommonMatchState,
    payload: { type: string },
    config: TournamentConfig,
    opts: AppendOpts,
  ): AppendResult;
  /** Denormalised columns for the events table, from the post-event state. */
  denormalize(state: CommonMatchState): DenormCols;
  /** Map the engine status → the matches.status enum. */
  matchStatusOf(state: CommonMatchState): MatchRowStatus;
}

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

// ── Beach adapter ────────────────────────────────────────────────────────────

const beachAdapter: EngineAdapter = {
  replay: (matchId, events, config) =>
    beachReplay(matchId, events as never, config) as unknown as CommonMatchState,
  reduce: (state, event, config) =>
    beachReduce(
      state as unknown as BeachMatchState,
      event as never,
      config,
    ) as unknown as CommonMatchState,
  append: (prev, payload, config, opts) =>
    appendBeachEvent(
      prev as unknown as BeachMatchState,
      payload as never,
      config,
      opts,
    ) as unknown as AppendResult,
  denormalize: (state) => {
    const set = beachActiveSet(state as unknown as BeachMatchState);
    const serverTeam = set?.currentServer ?? null;
    const serverPlayerNumber =
      set == null
        ? null
        : serverTeam === "A"
          ? set.serverPlayerA
          : set.serverPlayerB;
    const sidesAfter = set
      ? { teamA: set.teamASide, teamB: set.teamASide === "LEFT" ? "RIGHT" : "LEFT" }
      : null;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: (state as unknown as BeachMatchState).currentSetNumber,
      serverTeam,
      serverPlayerNumber,
      sidesAfter,
    };
  },
  matchStatusOf: (state) => rowStatusOf(state.status),
};

// ── Indoor adapter ───────────────────────────────────────────────────────────

const indoorAdapter: EngineAdapter = {
  replay: (matchId, events, config) =>
    indoorReplay(matchId, events as never, config) as unknown as CommonMatchState,
  reduce: (state, event, config) =>
    indoorReduce(
      state as unknown as IndoorMatchState,
      event as never,
      config,
    ) as unknown as CommonMatchState,
  append: (prev, payload, config, opts) =>
    appendIndoorEvent(
      prev as unknown as IndoorMatchState,
      payload as never,
      config,
      opts,
    ) as unknown as AppendResult,
  denormalize: (state) => {
    const set = indoorActiveSet(state as unknown as IndoorMatchState);
    const serverTeam = set?.currentServer ?? null;
    const sidesAfter = set
      ? { teamA: set.teamASide, teamB: set.teamASide === "LEFT" ? "RIGHT" : "LEFT" }
      : null;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: (state as unknown as IndoorMatchState).currentSetNumber,
      serverTeam,
      // Indoor servers are identified by player id, not a 1/2 number.
      serverPlayerNumber: null,
      sidesAfter,
    };
  },
  matchStatusOf: (state) => rowStatusOf(state.status),
};

// ── Grass adapter ────────────────────────────────────────────────────────────

const grassAdapter: EngineAdapter = {
  replay: (matchId, events, config) =>
    grassReplay(matchId, events as never, config) as unknown as CommonMatchState,
  reduce: (state, event, config) =>
    grassReduce(
      state as unknown as GrassMatchState,
      event as never,
      config,
    ) as unknown as CommonMatchState,
  append: (prev, payload, config, opts) =>
    appendGrassEvent(
      prev as unknown as GrassMatchState,
      payload as never,
      config,
      opts,
    ) as unknown as AppendResult,
  denormalize: (state) => {
    const set = grassActiveSet(state as unknown as GrassMatchState);
    const serverTeam = set?.currentServer ?? null;
    const lastRot =
      set == null ? null : serverTeam === "A" ? set.lastRotA : set.lastRotB;
    const sidesAfter = set
      ? { teamA: set.teamASide, teamB: set.teamASide === "LEFT" ? "RIGHT" : "LEFT" }
      : null;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: (state as unknown as GrassMatchState).currentSetNumber,
      serverTeam,
      // 1-based rotation position of the current server (null until first serve).
      serverPlayerNumber: lastRot == null ? null : lastRot + 1,
      sidesAfter,
    };
  },
  matchStatusOf: (state) => rowStatusOf(state.status),
};

// ── Light adapter ────────────────────────────────────────────────────────────

const lightAdapter: EngineAdapter = {
  replay: (matchId, events, config) =>
    lightReplay(matchId, events as never, config) as unknown as CommonMatchState,
  reduce: (state, event, config) =>
    lightReduce(
      state as unknown as LightMatchState,
      event as never,
      config,
    ) as unknown as CommonMatchState,
  append: (prev, payload, config, opts) =>
    appendLightEvent(
      prev as unknown as LightMatchState,
      payload as never,
      config,
      opts,
    ) as unknown as AppendResult,
  denormalize: (state) => {
    const set = lightActiveSet(state as unknown as LightMatchState);
    const serverTeam = set?.currentServer ?? null;
    const lastRot =
      set == null ? null : serverTeam === "A" ? set.lastRotA : set.lastRotB;
    const sidesAfter = set
      ? { teamA: set.teamASide, teamB: set.teamASide === "LEFT" ? "RIGHT" : "LEFT" }
      : null;
    return {
      scoreAfterA: set?.scoreA ?? null,
      scoreAfterB: set?.scoreB ?? null,
      setNumber: (state as unknown as LightMatchState).currentSetNumber,
      serverTeam,
      serverPlayerNumber: lastRot == null ? null : lastRot + 1,
      sidesAfter,
    };
  },
  matchStatusOf: (state) => rowStatusOf(state.status),
};

const REGISTRY: Partial<Record<Discipline, EngineAdapter>> = {
  BEACH: beachAdapter,
  INDOOR: indoorAdapter,
  GRASS: grassAdapter,
  LIGHT: lightAdapter,
};

/** The engine adapter for a discipline, or null if not yet supported. */
export function getEngine(discipline: Discipline): EngineAdapter | null {
  return REGISTRY[discipline] ?? null;
}

export function isDisciplineSupported(discipline: Discipline): boolean {
  return REGISTRY[discipline] != null;
}
