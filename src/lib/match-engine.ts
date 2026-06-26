// Server-side match orchestration: the bridge between the pure rule engines and
// the database + realtime layer.
//
//   - resolveMatchConfig: discipline defaults layered with the persisted overrides
//   - loadMatchState:     replay the event log (memoised per match instance)
//   - appendMatchEvent:   validate → persist primary + auto-emitted events →
//                         update the denormalised matches row → broadcast
//
// State is event-sourced: the matches table only holds *derived* convenience
// columns (setsWon, status, winner). The events table is the source of truth.
//
// Discipline-agnostic: the concrete engine is resolved per match via the engine
// registry (src/engine/registry.ts). Beach and indoor are supported today.
// `state` is typed as BeachMatchState for the historical beach callers, but is
// the discipline-correct state at runtime — indoor callers narrow it themselves.

import { aliasedTable, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, events, matches, teams, tournamentConfig } from "@/db/schema";
import { type TournamentConfig, resolveConfig } from "@/engine/config";
import {
  type CommonMatchState,
  type EngineEvent,
  getEngine,
} from "@/engine/registry";
import type { BeachEvent, BeachMatchState } from "@/engine/beach/types";
import type { Actor, Discipline } from "@/engine/types";
import { newId } from "@/lib/id";
import { broadcastServeClock, broadcastState } from "@/lib/realtime";

export class MatchNotFoundError extends Error {}
export class UnsupportedDisciplineError extends Error {}
export class EventRejectedError extends Error {}
export class SequenceConflictError extends Error {}

interface MatchMeta {
  matchId: string;
  tenantId: string;
  discipline: Discipline;
  config: TournamentConfig;
  engine: NonNullable<ReturnType<typeof getEngine>>;
}

// Per-instance state cache. Serverless instances are ephemeral, so this is a
// best-effort fast path — `loadMatchState` falls back to a full replay on miss.
const stateCache = new Map<
  string,
  { state: CommonMatchState; lastSequence: number }
>();

async function loadMatchMeta(matchId: string): Promise<MatchMeta> {
  const rows = await db
    .select({
      tenantId: matches.tenantId,
      discipline: matches.discipline,
      competitionId: matches.competitionId,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new MatchNotFoundError(`Match ${matchId} not found`);

  const discipline = row.discipline as Discipline;
  const engine = getEngine(discipline);
  if (!engine) {
    throw new UnsupportedDisciplineError(
      `Discipline ${discipline} is not yet supported`,
    );
  }

  const cfgRows = await db
    .select()
    .from(tournamentConfig)
    .where(eq(tournamentConfig.competitionId, row.competitionId))
    .limit(1);

  const overrides = (cfgRows[0] ?? {}) as unknown as Partial<TournamentConfig>;
  const config = resolveConfig(discipline, overrides);

  return { matchId, tenantId: row.tenantId, discipline, config, engine };
}

async function loadEvents(matchId: string): Promise<EngineEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      sequence: events.sequence,
      timestamp: events.timestamp,
      payload: events.payload,
    })
    .from(events)
    .where(eq(events.matchId, matchId))
    .orderBy(asc(events.sequence));

  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    timestamp: (r.timestamp as Date).toISOString(),
    payload: r.payload as EngineEvent["payload"],
  }));
}

export async function resolveMatchConfig(
  matchId: string,
): Promise<TournamentConfig> {
  return (await loadMatchMeta(matchId)).config;
}

/** Current state for a match (cache fast-path, else full replay). */
export async function loadMatchState(
  matchId: string,
): Promise<{ state: BeachMatchState; config: TournamentConfig }> {
  const meta = await loadMatchMeta(matchId);
  const cached = stateCache.get(matchId);
  if (cached) return { state: cached.state as unknown as BeachMatchState, config: meta.config };

  const log = await loadEvents(matchId);
  const state = meta.engine.replay(matchId, log, meta.config);
  stateCache.set(matchId, { state, lastSequence: state.lastSequence });
  return { state: state as unknown as BeachMatchState, config: meta.config };
}

/** Fresh state straight from the event log, bypassing the cache (for SSE polling). */
export async function loadMatchStateFresh(
  matchId: string,
): Promise<{ state: BeachMatchState; config: TournamentConfig }> {
  const meta = await loadMatchMeta(matchId);
  const log = await loadEvents(matchId);
  const state = meta.engine.replay(matchId, log, meta.config);
  stateCache.set(matchId, { state, lastSequence: state.lastSequence });
  return { state: state as unknown as BeachMatchState, config: meta.config };
}

export interface MatchView {
  matchId: string;
  discipline: Discipline;
  competitionName: string;
  teamAName: string;
  teamBName: string;
  state: BeachMatchState;
  config: TournamentConfig;
}

/** Everything the live scoring page needs: names + initial replayed state. */
export async function loadMatchView(matchId: string): Promise<MatchView> {
  const teamA = aliasedTable(teams, "team_a");
  const teamB = aliasedTable(teams, "team_b");
  const rows = await db
    .select({
      discipline: matches.discipline,
      competitionName: competitions.name,
      teamAName: teamA.displayName,
      teamBName: teamB.displayName,
    })
    .from(matches)
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(eq(matches.id, matchId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new MatchNotFoundError(`Match ${matchId} not found`);

  const { state, config } = await loadMatchStateFresh(matchId);
  return {
    matchId,
    discipline: row.discipline as Discipline,
    competitionName: row.competitionName,
    teamAName: row.teamAName,
    teamBName: row.teamBName,
    state,
    config,
  };
}

export interface AppendOutcome {
  newEvents: EngineEvent[];
  state: CommonMatchState;
}

/**
 * Validate and persist a new event (plus any auto-emitted consequences),
 * update the derived matches row, broadcast the new state, and return it.
 */
export async function appendMatchEvent(
  matchId: string,
  payload: { type: string } & Record<string, unknown>,
  opts: { actor?: Actor; deviceInfo?: string } = {},
): Promise<AppendOutcome> {
  const meta = await loadMatchMeta(matchId);

  // UNDO is special: it removes a prior event, so the post-state requires a full
  // re-replay rather than a forward reduce. The target is resolved server-side
  // (the latest non-UNDO, not-yet-undone event) so clients can just say "undo".
  if (payload.type === "UNDO") {
    return undoLastEvent(matchId, meta, opts.actor ?? "SCORER", opts.deviceInfo);
  }

  const { state: prevState } = await loadCommonState(matchId, meta);
  const actor: Actor = opts.actor ?? "SCORER";
  const isSystem = (type: string) =>
    type === "SET_END" ||
    type === "MATCH_END" ||
    type === "SIDE_SWITCH" ||
    type === "TTO_START";

  // Stable ids per sequence so the result and the persisted rows agree.
  const idForSeq = new Map<number, string>();
  const makeId = (seq: number) => {
    let id = idForSeq.get(seq);
    if (!id) {
      id = newId("evt");
      idForSeq.set(seq, id);
    }
    return id;
  };

  const result = meta.engine.append(prevState, payload, meta.config, {
    nextSequence: prevState.lastSequence + 1,
    timestamp: new Date().toISOString(),
    makeId,
  });

  if (!result.ok) throw new EventRejectedError(result.reason);

  // Build insert rows with per-event denormalised snapshots.
  let snapshot = prevState;
  const rows = result.newEvents.map((ev) => {
    snapshot = meta.engine.reduce(snapshot, ev, meta.config);
    const d = meta.engine.denormalize(snapshot);
    return {
      id: ev.id,
      matchId,
      tenantId: meta.tenantId,
      sequence: ev.sequence,
      timestamp: new Date(ev.timestamp),
      eventType: ev.payload.type,
      payload: ev.payload,
      actor: isSystem(ev.payload.type) ? ("SYSTEM" as Actor) : actor,
      deviceInfo: opts.deviceInfo ?? null,
      ...d,
    };
  });

  try {
    await db.insert(events).values(rows);
  } catch (err) {
    stateCache.delete(matchId);
    throw new SequenceConflictError(
      err instanceof Error ? err.message : "sequence conflict",
    );
  }

  const finalState = result.state;
  stateCache.set(matchId, {
    state: finalState,
    lastSequence: finalState.lastSequence,
  });

  await db
    .update(matches)
    .set({
      setsWonA: finalState.setsWonA,
      setsWonB: finalState.setsWonB,
      winner: finalState.winner,
      status: meta.engine.matchStatusOf(finalState),
      ...(finalState.matchStartedAt
        ? { startedAt: new Date(finalState.matchStartedAt) }
        : {}),
      ...(finalState.status === "FINISHED" ? { finishedAt: new Date() } : {}),
    })
    .where(eq(matches.id, matchId));

  // Broadcast: state to everyone, plus a serve-clock countdown after a rally.
  const lastEvent = result.newEvents[result.newEvents.length - 1];
  await broadcastState(matchId, { state: finalState, lastEvent });
  if (
    meta.config.serveClockEnabled &&
    (payload.type === "RALLY_WON_A" || payload.type === "RALLY_WON_B") &&
    finalState.status === "LIVE"
  ) {
    await broadcastServeClock(
      matchId,
      Date.now() + meta.config.serveClockSecs * 1000,
      meta.config.serveClockSecs,
    );
  }

  return { newEvents: result.newEvents, state: finalState };
}

/** Common-typed state from cache or replay (internal helper). */
async function loadCommonState(
  matchId: string,
  meta: MatchMeta,
): Promise<{ state: CommonMatchState }> {
  const cached = stateCache.get(matchId);
  if (cached) return { state: cached.state };
  const log = await loadEvents(matchId);
  const state = meta.engine.replay(matchId, log, meta.config);
  stateCache.set(matchId, { state, lastSequence: state.lastSequence });
  return { state };
}

/** Append an UNDO targeting the most recent undoable event, then re-replay. */
async function undoLastEvent(
  matchId: string,
  meta: MatchMeta,
  actor: Actor,
  deviceInfo?: string,
): Promise<AppendOutcome> {
  const log = await loadEvents(matchId);
  const alreadyUndone = new Set<string>();
  for (const ev of log) {
    if (ev.payload.type === "UNDO")
      alreadyUndone.add(ev.payload.targetEventId as string);
  }
  const target = [...log]
    .reverse()
    .find((ev) => ev.payload.type !== "UNDO" && !alreadyUndone.has(ev.id));
  if (!target) throw new EventRejectedError("Nothing to undo");

  const nextSeq = (log[log.length - 1]?.sequence ?? 0) + 1;
  const undoEvent: EngineEvent = {
    id: newId("evt"),
    sequence: nextSeq,
    timestamp: new Date().toISOString(),
    payload: { type: "UNDO", targetEventId: target.id },
  };

  const finalState = meta.engine.replay(
    matchId,
    [...log, undoEvent],
    meta.config,
  );

  try {
    await db.insert(events).values({
      id: undoEvent.id,
      matchId,
      tenantId: meta.tenantId,
      sequence: undoEvent.sequence,
      timestamp: new Date(undoEvent.timestamp),
      eventType: "UNDO",
      payload: undoEvent.payload,
      actor,
      deviceInfo: deviceInfo ?? null,
      ...meta.engine.denormalize(finalState),
    });
  } catch (err) {
    stateCache.delete(matchId);
    throw new SequenceConflictError(
      err instanceof Error ? err.message : "sequence conflict",
    );
  }

  stateCache.set(matchId, {
    state: finalState,
    lastSequence: finalState.lastSequence,
  });
  await db
    .update(matches)
    .set({
      setsWonA: finalState.setsWonA,
      setsWonB: finalState.setsWonB,
      winner: finalState.winner,
      status: meta.engine.matchStatusOf(finalState),
    })
    .where(eq(matches.id, matchId));
  await broadcastState(matchId, { state: finalState, lastEvent: undoEvent });

  return { newEvents: [undoEvent], state: finalState };
}

// Re-export for callers that still import the beach event type from here.
export type { BeachEvent };
