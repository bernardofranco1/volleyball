// Server-side match orchestration: the bridge between the pure rule engines and
// the database + realtime layer.
//
//   - resolveMatchConfig: discipline defaults layered with the persisted overrides
//   - loadMatchState:     snapshot + tail-replay (spec/14 §C1)
//   - appendMatchEvent:   validate → persist primary + auto-emitted events +
//                         snapshot (one transaction) → broadcast
//
// State is event-sourced: the events table is the source of truth. The matches
// row holds derived columns (setsWon, status, winner) PLUS a `state_snapshot`
// cache so reads replay only events beyond `snapshot_sequence` rather than the
// whole log. The snapshot is just a cache — if absent/behind, a tail (or full)
// replay heals it, so correctness never depends on it.
//
// Discipline-agnostic via the engine registry (src/engine/registry.ts). `state`
// is typed as BeachMatchState for historical beach callers but is the
// discipline-correct state at runtime — indoor/grass/light callers narrow it.

import { aliasedTable, and, asc, eq, gt } from "drizzle-orm";
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
import {
  broadcastServeClock,
  broadcastState,
  broadcastTimeout,
} from "@/lib/realtime";

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

function toEngineEvent(r: {
  id: string;
  sequence: number;
  timestamp: Date;
  payload: unknown;
}): EngineEvent {
  return {
    id: r.id,
    sequence: r.sequence,
    timestamp: (r.timestamp as Date).toISOString(),
    payload: r.payload as EngineEvent["payload"],
  };
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
  return rows.map(toEngineEvent);
}

/**
 * Authoritative current state: load the cached snapshot, then replay only events
 * after `snapshot_sequence`. Falls back to a full replay when no snapshot exists.
 */
async function loadState(
  matchId: string,
  meta: MatchMeta,
): Promise<CommonMatchState> {
  const row = (
    await db
      .select({
        snap: matches.stateSnapshot,
        seq: matches.snapshotSequence,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];

  const hasSnap = row?.snap != null;
  const baseSeq = hasSnap ? (row.seq ?? 0) : 0;
  let state = hasSnap
    ? (row.snap as CommonMatchState)
    : meta.engine.replay(matchId, [], meta.config);

  const tail = await db
    .select({
      id: events.id,
      sequence: events.sequence,
      timestamp: events.timestamp,
      payload: events.payload,
    })
    .from(events)
    .where(and(eq(events.matchId, matchId), gt(events.sequence, baseSeq)))
    .orderBy(asc(events.sequence));
  for (const r of tail) state = meta.engine.reduce(state, toEngineEvent(r), meta.config);
  return state;
}

export async function resolveMatchConfig(
  matchId: string,
): Promise<TournamentConfig> {
  return (await loadMatchMeta(matchId)).config;
}

/** Current state for a match (snapshot + tail replay). */
export async function loadMatchState(
  matchId: string,
): Promise<{ state: BeachMatchState; config: TournamentConfig }> {
  const meta = await loadMatchMeta(matchId);
  const state = await loadState(matchId, meta);
  return { state: state as unknown as BeachMatchState, config: meta.config };
}

/** Alias kept for callers expecting authoritative state (e.g. /state route). */
export const loadMatchStateFresh = loadMatchState;

export interface MatchView {
  matchId: string;
  discipline: Discipline;
  competitionName: string;
  teamAName: string;
  teamBName: string;
  scheduledAt: Date | null;
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
      scheduledAt: matches.scheduledAt,
    })
    .from(matches)
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .innerJoin(teamA, eq(teamA.id, matches.teamAId))
    .innerJoin(teamB, eq(teamB.id, matches.teamBId))
    .where(eq(matches.id, matchId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new MatchNotFoundError(`Match ${matchId} not found`);

  const { state, config } = await loadMatchState(matchId);
  return {
    matchId,
    discipline: row.discipline as Discipline,
    competitionName: row.competitionName,
    teamAName: row.teamAName,
    teamBName: row.teamBName,
    scheduledAt: row.scheduledAt,
    state,
    config,
  };
}

export interface AppendOutcome {
  newEvents: EngineEvent[];
  state: CommonMatchState;
}

const SYSTEM_EVENTS = new Set([
  "SET_END",
  "MATCH_END",
  "SIDE_SWITCH",
  "TTO_START",
]);

/** Derived matches-row columns written alongside the snapshot on every change. */
function derivedMatchColumns(meta: MatchMeta, finalState: CommonMatchState) {
  return {
    setsWonA: finalState.setsWonA,
    setsWonB: finalState.setsWonB,
    winner: finalState.winner,
    status: meta.engine.matchStatusOf(finalState),
    stateSnapshot: finalState,
    snapshotSequence: finalState.lastSequence,
    ...(finalState.matchStartedAt
      ? { startedAt: new Date(finalState.matchStartedAt) }
      : {}),
    ...(finalState.status === "FINISHED" ? { finishedAt: new Date() } : {}),
  };
}

/**
 * Validate and persist a new event (plus auto-emitted consequences) and the
 * fresh snapshot in one transaction, then broadcast a change signal.
 */
export async function appendMatchEvent(
  matchId: string,
  payload: { type: string } & Record<string, unknown>,
  opts: { actor?: Actor; deviceInfo?: string } = {},
): Promise<AppendOutcome> {
  const meta = await loadMatchMeta(matchId);

  // UNDO removes a prior event, so the post-state requires a full re-replay
  // (the snapshot already includes the target's effect; reduce can't undo it).
  if (payload.type === "UNDO") {
    return undoLastEvent(matchId, meta, opts.actor ?? "SCORER", opts.deviceInfo);
  }

  const prevState = await loadState(matchId, meta);
  const actor: Actor = opts.actor ?? "SCORER";

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

  // Per-event denormalised snapshots for the event rows.
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
      actor: SYSTEM_EVENTS.has(ev.payload.type) ? ("SYSTEM" as Actor) : actor,
      deviceInfo: opts.deviceInfo ?? null,
      ...d,
    };
  });

  const finalState = result.state;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(events).values(rows);
      await tx
        .update(matches)
        .set(derivedMatchColumns(meta, finalState))
        .where(eq(matches.id, matchId));
    });
  } catch (err) {
    // Most likely a unique(matchId, sequence) violation from a concurrent writer.
    throw new SequenceConflictError(
      err instanceof Error ? err.message : "sequence conflict",
    );
  }

  await broadcastState(matchId, finalState.lastSequence);
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
  // Team time-out countdown for the public board (brief §4.3).
  if (
    finalState.rallyPhase === "TIMEOUT_ACTIVE" &&
    payload.type === "TIMEOUT_REQUEST"
  ) {
    const team = (payload as { team?: "A" | "B" }).team;
    if (team)
      await broadcastTimeout(
        matchId,
        Date.now() + meta.config.timeoutDurationSecs * 1000,
        team,
        meta.config.timeoutDurationSecs,
      );
  }

  return { newEvents: result.newEvents, state: finalState };
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

  const finalState = meta.engine.replay(matchId, [...log, undoEvent], meta.config);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(events).values({
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
      await tx
        .update(matches)
        .set(derivedMatchColumns(meta, finalState))
        .where(eq(matches.id, matchId));
    });
  } catch (err) {
    throw new SequenceConflictError(
      err instanceof Error ? err.message : "sequence conflict",
    );
  }

  await broadcastState(matchId, finalState.lastSequence);
  return { newEvents: [undoEvent], state: finalState };
}

// Re-export for callers that still import the beach event type from here.
export type { BeachEvent };
