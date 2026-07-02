// Factories for the append/replay orchestration shared verbatim by all four
// discipline engines. Pure and fully structural — a discipline plugs in its
// validate/reduce/computeAutoEmits and gets back functions with its own
// concrete state/event types (no casts, no `any`).

import type { TournamentConfig } from "../config";

export interface EngineEvent<P> {
  id: string;
  sequence: number;
  timestamp: string; // ISO 8601
  payload: P;
}

export interface AppendOpts {
  nextSequence: number;
  timestamp: string;
  makeId: (sequence: number) => string;
}

export type AppendResult<S, P> =
  | { ok: false; reason: string }
  | { ok: true; newEvents: EngineEvent<P>[]; state: S };

/**
 * Build the append orchestration: validate, apply the primary event, then
 * append any auto-emitted consequences (only after a scoring event, so a
 * non-scoring event at a side-switch sum cannot re-trigger one). Pure — the
 * caller supplies sequence/timestamp/id and persists `newEvents`.
 */
export function createAppendFn<S, P extends { type: string }>(deps: {
  validate: (
    payload: P,
    state: S,
    config: TournamentConfig,
  ) => { ok: boolean; reason?: string };
  reduce: (state: S, event: EngineEvent<P>, config: TournamentConfig) => S;
  computeAutoEmits: (state: S, config: TournamentConfig) => P[];
  isScoringEvent: (type: P["type"]) => boolean;
}): (
  prevState: S,
  payload: P,
  config: TournamentConfig,
  opts: AppendOpts,
) => AppendResult<S, P> {
  return function append(prevState, payload, config, opts) {
    const validation = deps.validate(payload, prevState, config);
    if (!validation.ok) return { ok: false, reason: validation.reason! };

    let seq = opts.nextSequence;
    const newEvents: EngineEvent<P>[] = [];
    let state = prevState;

    const primary: EngineEvent<P> = {
      id: opts.makeId(seq),
      sequence: seq,
      timestamp: opts.timestamp,
      payload,
    };
    newEvents.push(primary);
    state = deps.reduce(state, primary, config);
    seq += 1;

    if (deps.isScoringEvent(payload.type)) {
      for (const emit of deps.computeAutoEmits(state, config)) {
        const ev: EngineEvent<P> = {
          id: opts.makeId(seq),
          sequence: seq,
          timestamp: opts.timestamp,
          payload: emit,
        };
        newEvents.push(ev);
        state = deps.reduce(state, ev, config);
        seq += 1;
      }
    }

    return { ok: true, newEvents, state };
  };
}

/** Every discipline's UNDO payload has exactly this shape. */
function isUndoPayload(p: {
  type: string;
}): p is { type: "UNDO"; targetEventId: string } {
  return p.type === "UNDO";
}

/**
 * Build the replay function: rebuild match state from the full event log.
 * UNDO events tombstone their target out of the replay (UNDO events themselves
 * are never removed).
 */
export function createReplayFn<S, P extends { type: string }>(
  initialState: (matchId: string) => S,
  reduce: (state: S, event: EngineEvent<P>, config: TournamentConfig) => S,
): (matchId: string, events: EngineEvent<P>[], config: TournamentConfig) => S {
  return function replayEvents(matchId, events, config) {
    const undone = new Set<string>();
    for (const ev of events) {
      if (isUndoPayload(ev.payload)) undone.add(ev.payload.targetEventId);
    }
    let state = initialState(matchId);
    for (const ev of events) {
      if (ev.payload.type !== "UNDO" && undone.has(ev.id)) continue;
      state = reduce(state, ev, config);
    }
    return state;
  };
}
