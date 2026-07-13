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
 * REWIND {toSequence} is a control event (not a discipline event, so it isn't
 * in any `P` union): it truncates the match back to `toSequence`, logically
 * erasing every event scored after it. Admin "re-score from here" (spec/17).
 */
function isRewindPayload(p: {
  type: string;
}): p is { type: "REWIND"; toSequence: number } {
  return p.type === "REWIND";
}

/**
 * Build the replay function: rebuild match state from the full event log.
 *
 * Control events are resolved in one ascending-sequence pass over a growing
 * "survivors" list (never applied via reduce themselves):
 *   - UNDO      → drop its target event from the survivors so far
 *   - REWIND(N) → drop every survivor with sequence > N (truncate the tail)
 * Events scored *after* a control event are appended normally, so re-scoring
 * after a rewind survives, and a later/deeper rewind naturally supersedes an
 * earlier one. The final surviving events are folded through `reduce`.
 */
export function createReplayFn<
  S extends { lastSequence: number },
  P extends { type: string },
>(
  initialState: (matchId: string) => S,
  reduce: (state: S, event: EngineEvent<P>, config: TournamentConfig) => S,
): (matchId: string, events: EngineEvent<P>[], config: TournamentConfig) => S {
  return function replayEvents(matchId, events, config) {
    const survivors: EngineEvent<P>[] = [];
    let maxSeq = 0;
    for (const ev of events) {
      if (ev.sequence > maxSeq) maxSeq = ev.sequence;
      if (isUndoPayload(ev.payload)) {
        const target = ev.payload.targetEventId;
        const i = survivors.findIndex((s) => s.id === target);
        if (i !== -1) survivors.splice(i, 1);
        continue; // control marker — never reduced
      }
      if (isRewindPayload(ev.payload)) {
        const cutoff = ev.payload.toSequence;
        for (let i = survivors.length - 1; i >= 0; i--) {
          if (survivors[i].sequence > cutoff) survivors.splice(i, 1);
        }
        continue; // control marker — never reduced
      }
      survivors.push(ev);
    }
    let state = initialState(matchId);
    for (const ev of survivors) state = reduce(state, ev, config);
    // lastSequence must mark the LOG head, not the last surviving event.
    // Control events (UNDO/REWIND) drop survivors, so the fold above can end
    // below the head; persisting that as snapshot_sequence made the next
    // snapshot+tail load re-apply the undone events (reduce treats UNDO as a
    // no-op) — resurrecting undone points on refresh — and would hand out
    // already-used sequence numbers to the next append.
    if (maxSeq > state.lastSequence) state = { ...state, lastSequence: maxSeq };
    return state;
  };
}
