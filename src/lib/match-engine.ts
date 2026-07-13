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
// replay heals it, so correctness never depends on it. To keep write volume
// down it's refreshed every few events (and on every set/match boundary), not
// per rally.

import { after } from "next/server";
import { aliasedTable, and, asc, eq, gt, max } from "drizzle-orm";
import { db } from "@/db";
import { competitions, events, matches, teams, tournamentConfig } from "@/db/schema";
import { type TournamentConfig, resolveConfig } from "@/engine/config";
import {
  type CommonMatchState,
  type EngineEvent,
  type MatchRowStatus,
  getEngine,
} from "@/engine/registry";
import type { BeachMatchState } from "@/engine/beach/types";
import type { IndoorMatchState } from "@/engine/indoor/types";
import type { GrassMatchState } from "@/engine/grass/types";
import type { LightMatchState } from "@/engine/light/types";
import type { Actor, Discipline } from "@/engine/types";
import { newId } from "@/lib/id";
import {
  type BroadcastMessage,
  broadcastMessages,
  serveClockMessage,
  stateUpdateMessage,
} from "@/lib/realtime";

export class MatchNotFoundError extends Error {}
export class UnsupportedDisciplineError extends Error {}
export class EventRejectedError extends Error {}
export class SequenceConflictError extends Error {}

// Refresh the snapshot cache every N events (plus every set/match boundary).
// Tail replays stay ≤ N events while the matches-row write shrinks from a
// 10-50KB jsonb rewrite per rally to one every N rallies.
const SNAPSHOT_EVERY = 5;

interface MatchMeta {
  matchId: string;
  tenantId: string;
  discipline: Discipline;
  config: TournamentConfig;
  engine: NonNullable<ReturnType<typeof getEngine>>;
  /** Snapshot columns, fetched with the meta so loads are one round trip. */
  snap: unknown | null;
  snapshotSeq: number;
}

/** One query: match row + config overrides + snapshot columns. */
async function loadMatchMeta(matchId: string): Promise<MatchMeta> {
  const rows = await db
    .select({
      tenantId: matches.tenantId,
      discipline: matches.discipline,
      snap: matches.stateSnapshot,
      snapshotSeq: matches.snapshotSequence,
      cfg: tournamentConfig,
    })
    .from(matches)
    .leftJoin(
      tournamentConfig,
      eq(tournamentConfig.competitionId, matches.competitionId),
    )
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

  const overrides = (row.cfg ?? {}) as unknown as Partial<TournamentConfig>;
  const config = resolveConfig(discipline, overrides);

  return {
    matchId,
    tenantId: row.tenantId,
    discipline,
    config,
    engine,
    snap: row.snap,
    snapshotSeq: row.snapshotSeq ?? 0,
  };
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

/** Latest event sequence for a match (cheap indexed max; 0 when no events). */
export async function latestSequence(matchId: string): Promise<number> {
  const rows = await db
    .select({ n: max(events.sequence) })
    .from(events)
    .where(eq(events.matchId, matchId));
  return rows[0]?.n ?? 0;
}

/**
 * Authoritative current state: start from the snapshot fetched with the meta,
 * then replay only events after `snapshot_sequence`. Falls back to a full
 * replay when no snapshot exists.
 */
async function loadState(
  matchId: string,
  meta: MatchMeta,
): Promise<CommonMatchState> {
  const hasSnap = meta.snap != null;
  const baseSeq = hasSnap ? meta.snapshotSeq : 0;

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

  // Control events (UNDO/REWIND) can't be applied incrementally: the discipline
  // reducers treat them as no-ops, and their targets may sit inside the
  // snapshot. If any appear past the snapshot (stale snapshot, or one written
  // before replay stamped lastSequence at the log head), rebuild from the full
  // log via engine.replay, which resolves them correctly.
  const hasControl = tail.some((r) => {
    const t = (r.payload as { type?: string } | null)?.type;
    return t === "UNDO" || t === "REWIND";
  });
  if (!hasSnap || hasControl) {
    // baseSeq 0 ⇒ the tail already IS the full log.
    const all = baseSeq === 0 ? tail : await db
      .select({
        id: events.id,
        sequence: events.sequence,
        timestamp: events.timestamp,
        payload: events.payload,
      })
      .from(events)
      .where(eq(events.matchId, matchId))
      .orderBy(asc(events.sequence));
    return meta.engine.replay(matchId, all.map(toEngineEvent), meta.config);
  }

  let state = meta.snap as CommonMatchState;
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

interface MatchViewBase {
  matchId: string;
  competitionName: string;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  scheduledAt: Date | null;
  config: TournamentConfig;
}

/**
 * Discriminated on `discipline` so `switch (view.discipline)` narrows `state`
 * to the right engine's type — no `as unknown as` casts in page code.
 */
export type MatchView =
  | (MatchViewBase & { discipline: "BEACH"; state: BeachMatchState })
  | (MatchViewBase & { discipline: "INDOOR"; state: IndoorMatchState })
  | (MatchViewBase & { discipline: "GRASS"; state: GrassMatchState })
  | (MatchViewBase & { discipline: "LIGHT"; state: LightMatchState });

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
      teamAColor: teamA.color,
      teamBColor: teamB.color,
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
    // The runtime state IS discipline-correct (built by that discipline's
    // engine); this single boundary cast replaces the per-page ones.
    discipline: row.discipline as Discipline,
    competitionName: row.competitionName,
    teamAName: row.teamAName,
    teamBName: row.teamBName,
    teamAColor: row.teamAColor,
    teamBColor: row.teamBColor,
    scheduledAt: row.scheduledAt,
    state,
    config,
  } as MatchView;
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

/**
 * Derived matches-row columns written on every change. The heavyweight
 * `state_snapshot` jsonb is included only at snapshot points (every
 * SNAPSHOT_EVERY events, set/match boundaries, and always after UNDO — an
 * undo invalidates the previous snapshot, which would otherwise resurrect the
 * undone event on the next load).
 */
function derivedMatchColumns(
  meta: MatchMeta,
  finalState: CommonMatchState,
  opts: { includeSnapshot: boolean; status?: MatchRowStatus },
) {
  // Caller may override the row status (a scorer's final point parks the match
  // at PENDING_CONFIRMATION even though the engine reports FINISHED).
  const status = opts.status ?? meta.engine.matchStatusOf(finalState);
  return {
    setsWonA: finalState.setsWonA,
    setsWonB: finalState.setsWonB,
    winner: finalState.winner,
    status,
    ...(opts.includeSnapshot
      ? {
          stateSnapshot: finalState,
          snapshotSequence: finalState.lastSequence,
        }
      : {}),
    ...(finalState.matchStartedAt
      ? { startedAt: new Date(finalState.matchStartedAt) }
      : {}),
    // Set only when actually FINISHED (not while pending); explicitly cleared
    // when a rewind takes a match back out of FINISHED.
    finishedAt: status === "FINISHED" ? new Date() : null,
  };
}

/**
 * Snapshot cache write policy (pure — exported for tests): refresh when no
 * snapshot exists yet, every SNAPSHOT_EVERY events, whenever the match leaves
 * LIVE, and on any set/match boundary (system auto-emits).
 */
export function shouldSnapshot(
  hasSnapshot: boolean,
  snapshotSeq: number,
  finalState: Pick<CommonMatchState, "lastSequence" | "status">,
  newEvents: EngineEvent[],
): boolean {
  return (
    !hasSnapshot ||
    finalState.lastSequence - snapshotSeq >= SNAPSHOT_EVERY ||
    finalState.status !== "LIVE" ||
    newEvents.some((ev) => SYSTEM_EVENTS.has(ev.payload.type))
  );
}

/** Sequence-conflict detection: only a unique violation on (match, sequence). */
function toWriteError(err: unknown): Error {
  const code = (err as { code?: string })?.code;
  if (code === "23505")
    return new SequenceConflictError(
      err instanceof Error ? err.message : "sequence conflict",
    );
  // Anything else (connection drop, FK violation, …) is a real fault — don't
  // dress it up as "concurrent write, please retry".
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Send realtime signals in ONE batched request, after the response has been
 * flushed (`after()`); falls back to fire-and-forget outside a request scope
 * (scripts/tests). Broadcast failures are already swallowed inside
 * `broadcastMessages` — clients reconcile via the /state backstop.
 */
function scheduleBroadcast(msgs: BroadcastMessage[]): void {
  if (msgs.length === 0) return;
  const send = () => broadcastMessages(msgs);
  try {
    after(send);
  } catch {
    void send();
  }
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
  const includeSnapshot = shouldSnapshot(
    meta.snap != null,
    meta.snapshotSeq,
    finalState,
    result.newEvents,
  );
  // Scorer's final point doesn't finalise the result — it parks the match at
  // PENDING_CONFIRMATION until a manager confirms it (spec/17, feature 5).
  const engineStatus = meta.engine.matchStatusOf(finalState);
  const status: MatchRowStatus =
    engineStatus === "FINISHED" ? "PENDING_CONFIRMATION" : engineStatus;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(events).values(rows);
      await tx
        .update(matches)
        .set(derivedMatchColumns(meta, finalState, { includeSnapshot, status }))
        .where(eq(matches.id, matchId));
    });
  } catch (err) {
    throw toWriteError(err);
  }

  // Collect all realtime signals for this append into one batched request.
  const msgs: BroadcastMessage[] = [
    stateUpdateMessage(matchId, finalState.lastSequence),
  ];
  if (
    meta.config.serveClockEnabled &&
    (payload.type === "RALLY_WON_A" || payload.type === "RALLY_WON_B") &&
    finalState.status === "LIVE"
  ) {
    msgs.push(
      serveClockMessage(
        matchId,
        Date.now() + meta.config.serveClockSecs * 1000,
        meta.config.serveClockSecs,
      ),
    );
  }
  // (Time-out countdowns no longer broadcast a dedicated message: boards and
  // tablets derive them from `activeTimeoutStartedAt` in the state they refetch
  // on the state-update signal — one source of truth for every surface.)
  scheduleBroadcast(msgs);

  return { newEvents: result.newEvents, state: finalState };
}

/**
 * Which events an "Undo" removes (pure — exported for tests).
 *
 * The target is the most recent *scorer-submitted* undoable event; any
 * auto-emitted consequences that followed it (SET_END / MATCH_END /
 * SIDE_SWITCH / TTO_START) are undone with it. Targeting system events
 * directly used to strand scorers in TTO: undoing during one removed only
 * TTO_START (the mis-tapped point survived), undoing after ending it removed
 * TTO_END (straight back into the TTO), and undoing only the rally left the
 * surviving TTO_START replaying the match back into TTO_ACTIVE.
 */
export function selectUndoTargets(log: EngineEvent[]): EngineEvent[] {
  const alreadyUndone = new Set<string>();
  for (const ev of log) {
    if (ev.payload.type === "UNDO")
      alreadyUndone.add(ev.payload.targetEventId as string);
  }
  const target = [...log]
    .reverse()
    .find(
      (ev) =>
        ev.payload.type !== "UNDO" &&
        !alreadyUndone.has(ev.id) &&
        !SYSTEM_EVENTS.has(ev.payload.type),
    );
  if (!target) return [];
  // Auto-emits only ever follow a scoring event in its own append batch, and
  // `target` is the LAST scorer event — every later system event is its doing.
  const followers = log.filter(
    (ev) =>
      ev.sequence > target.sequence &&
      SYSTEM_EVENTS.has(ev.payload.type) &&
      !alreadyUndone.has(ev.id),
  );
  return [target, ...followers];
}

/** Append UNDOs for the last scorer action (+ its auto-emits), then re-replay. */
async function undoLastEvent(
  matchId: string,
  meta: MatchMeta,
  actor: Actor,
  deviceInfo?: string,
): Promise<AppendOutcome> {
  const log = await loadEvents(matchId);
  const targets = selectUndoTargets(log);
  if (targets.length === 0) throw new EventRejectedError("Nothing to undo");

  let nextSeq = (log[log.length - 1]?.sequence ?? 0) + 1;
  const timestamp = new Date().toISOString();
  const undoEvents: EngineEvent[] = targets.map((t) => ({
    id: newId("evt"),
    sequence: nextSeq++,
    timestamp,
    payload: { type: "UNDO", targetEventId: t.id },
  }));

  const finalState = meta.engine.replay(
    matchId,
    [...log, ...undoEvents],
    meta.config,
  );

  try {
    await db.transaction(async (tx) => {
      const d = meta.engine.denormalize(finalState);
      await tx.insert(events).values(
        undoEvents.map((ev) => ({
          id: ev.id,
          matchId,
          tenantId: meta.tenantId,
          sequence: ev.sequence,
          timestamp: new Date(ev.timestamp),
          eventType: "UNDO",
          payload: ev.payload,
          actor,
          deviceInfo: deviceInfo ?? null,
          ...d,
        })),
      );
      await tx
        .update(matches)
        // Always refresh the snapshot after an undo — the old one contains the
        // undone event's effect and must not be replayed from.
        .set(derivedMatchColumns(meta, finalState, { includeSnapshot: true }))
        .where(eq(matches.id, matchId));
    });
  } catch (err) {
    throw toWriteError(err);
  }

  scheduleBroadcast([stateUpdateMessage(matchId, finalState.lastSequence)]);
  return { newEvents: undoEvents, state: finalState };
}

export class RewindRejectedError extends Error {}

/**
 * Admin rewind (spec/17): logically erase `fromSequence` and every event after
 * it, so scoring can be re-done manually from that point. Appends a single
 * REWIND control event (keeps events with sequence < fromSequence), re-replays,
 * and force-refreshes the snapshot. A FINISHED match rewound mid-play returns
 * to LIVE (derived columns + finishedAt recompute from the replayed state).
 * The event log stays append-only — nothing is deleted.
 */
export async function rewindMatch(
  matchId: string,
  fromSequence: number,
  opts: { actor?: Actor; deviceInfo?: string } = {},
): Promise<AppendOutcome> {
  const meta = await loadMatchMeta(matchId);
  const log = await loadEvents(matchId);
  const maxSeq = log[log.length - 1]?.sequence ?? 0;

  if (!Number.isInteger(fromSequence) || fromSequence <= 1)
    // seq 1 is MATCH_CREATED — a rewind must keep the match itself.
    throw new RewindRejectedError("Choose a point after the start of the match.");
  if (fromSequence > maxSeq)
    throw new RewindRejectedError("Nothing to erase after that point.");

  const rewind: EngineEvent = {
    id: newId("evt"),
    sequence: maxSeq + 1,
    timestamp: new Date().toISOString(),
    payload: { type: "REWIND", toSequence: fromSequence - 1 },
  };

  const finalState = meta.engine.replay(matchId, [...log, rewind], meta.config);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(events).values({
        id: rewind.id,
        matchId,
        tenantId: meta.tenantId,
        sequence: rewind.sequence,
        timestamp: new Date(rewind.timestamp),
        eventType: "REWIND",
        payload: rewind.payload,
        actor: opts.actor ?? "SCORER",
        deviceInfo: opts.deviceInfo ?? null,
        ...meta.engine.denormalize(finalState),
      });
      await tx
        .update(matches)
        // Rewind invalidates the cached snapshot — always rewrite it.
        .set(derivedMatchColumns(meta, finalState, { includeSnapshot: true }))
        .where(eq(matches.id, matchId));
    });
  } catch (err) {
    throw toWriteError(err);
  }

  scheduleBroadcast([stateUpdateMessage(matchId, finalState.lastSequence)]);
  return { newEvents: [rewind], state: finalState };
}
