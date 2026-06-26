/**
 * Pure rule engine for beach volleyball. `reduce(state, event, config)` is a
 * pure function — no I/O, no side effects. State is rebuilt by replaying the
 * append-only event log (`replayEvents`). Auto-emitted events (SET_END,
 * MATCH_END, SIDE_SWITCH, TTO_START) are computed by `computeAutoEmits` and
 * appended by the API layer after a scoring event.
 */

import type { TournamentConfig } from "../config";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  type BeachSetState,
  type PlayerNumber,
  type Side,
  type SetNumber,
  type TeamId,
  activeSet,
  initialBeachState,
  oppositeSide,
} from "./types";
import { validateBeachEvent } from "./validator";

// ── pure rule predicates (config-driven) ─────────────────────────────────────

/** Points needed to win a set, ignoring the two-point rule. */
export function setWinTarget(
  setNumber: SetNumber,
  config: TournamentConfig,
): number {
  return setNumber >= config.bestOf ? config.setScoreTiebreak : config.setScore;
}

export function setWinner(
  set: BeachSetState,
  config: TournamentConfig,
): TeamId | null {
  const target = setWinTarget(set.setNumber, config);
  const lead = config.twoPointLead ? 2 : 1;
  if (set.scoreA >= target && set.scoreA - set.scoreB >= lead) return "A";
  if (set.scoreB >= target && set.scoreB - set.scoreA >= lead) return "B";
  return null;
}

export function isSetWon(set: BeachSetState, config: TournamentConfig): boolean {
  return setWinner(set, config) !== null;
}

/** Beach side-switch fires every N total points (config; 7 normal / 5 decider). */
export function isSideSwitchDue(
  set: BeachSetState,
  config: TournamentConfig,
): boolean {
  if (!config.sideSwitchEnabled) return false;
  const interval =
    set.setNumber >= config.bestOf
      ? config.sideSwitchTiebreakEvery
      : config.sideSwitchEvery;
  if (!interval) return false;
  const sum = set.scoreA + set.scoreB;
  return sum > 0 && sum % interval === 0;
}

/** Technical time-out: once per non-deciding set when the point sum hits the trigger. */
export function isTTODue(set: BeachSetState, config: TournamentConfig): boolean {
  if (!config.ttoEnabled || config.ttoTriggerScore == null) return false;
  if (set.setNumber >= config.bestOf) return false; // no TTO in the deciding set
  if (set.ttoFired) return false;
  return set.scoreA + set.scoreB === config.ttoTriggerScore;
}

export function setsNeededToWin(config: TournamentConfig): number {
  return Math.floor(config.bestOf / 2) + 1;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newSetState(
  setNumber: SetNumber,
  firstServer: TeamId,
  teamAStartSide: Side,
  config: TournamentConfig,
): BeachSetState {
  return {
    setNumber,
    scoreA: 0,
    scoreB: 0,
    teamAStartSide,
    teamASide: teamAStartSide,
    firstServer,
    currentServer: firstServer,
    // The first server's player 1 serves first; the other team has not served.
    serverPlayerA: firstServer === "A" ? 1 : null,
    serverPlayerB: firstServer === "B" ? 1 : null,
    timeoutsUsedA: 0,
    timeoutsUsedB: 0,
    ttoFired: false,
    challengesRemainingA: config.vcsEnabled ? config.vcsChallengesPerSet : 0,
    challengesRemainingB: config.vcsEnabled ? config.vcsChallengesPerSet : 0,
    delaySanctionsA: 0,
    delaySanctionsB: 0,
    winner: null,
    startedAt: null,
    endedAt: null,
  };
}

/** Apply a won rally to a set: bump score and advance the server. */
function applyPoint(set: BeachSetState, winner: TeamId): BeachSetState {
  const s = clone(set);
  const wasServing = s.currentServer === winner;

  if (winner === "A") s.scoreA += 1;
  else s.scoreB += 1;

  if (!wasServing) {
    // Side-out: the receiving team gains serve. Its server alternates — or, if
    // it has not served yet this set, its player 1 serves first.
    s.currentServer = winner;
    if (winner === "A") {
      s.serverPlayerA = s.serverPlayerA == null ? 1 : flip(s.serverPlayerA);
    } else {
      s.serverPlayerB = s.serverPlayerB == null ? 1 : flip(s.serverPlayerB);
    }
  }
  // If the serving team won, the same player keeps serving — no change.
  return s;
}

function flip(p: PlayerNumber): PlayerNumber {
  return p === 1 ? 2 : 1;
}

// ── main reducer ─────────────────────────────────────────────────────────────

export function reduce(
  state: BeachMatchState,
  event: BeachEvent,
  config: TournamentConfig,
): BeachMatchState {
  const s = clone(state);
  const p = event.payload;
  s.lastSequence = event.sequence;
  const setIdx = s.currentSetNumber - 1;

  switch (p.type) {
    case "MATCH_CREATED":
      s.status = "COIN_TOSS";
      return s;

    case "COIN_TOSS":
      s.status = "READY";
      s.set1FirstServer = p.firstServer;
      return s;

    case "MATCH_START":
      s.status = "LIVE";
      s.matchStartedAt = event.timestamp;
      return s;

    case "SET_START": {
      const set = newSetState(
        p.setNumber,
        p.firstServer,
        p.teamAStartSide,
        config,
      );
      set.startedAt = event.timestamp;
      s.sets[p.setNumber - 1] = set;
      s.currentSetNumber = p.setNumber;
      if (p.setNumber === 1) s.set1FirstServer = p.firstServer;
      s.status = "LIVE";
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "RALLY_START":
      s.rallyPhase = "RALLY_LIVE";
      return s;

    case "RALLY_WON_A":
    case "RALLY_WON_B": {
      const winner: TeamId = p.type === "RALLY_WON_A" ? "A" : "B";
      if (s.sets[setIdx]) s.sets[setIdx] = applyPoint(s.sets[setIdx], winner);
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "REPLAY_POINT":
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "TIMEOUT_REQUEST":
      if (s.sets[setIdx]) {
        if (p.team === "A") s.sets[setIdx].timeoutsUsedA += 1;
        else s.sets[setIdx].timeoutsUsedB += 1;
      }
      s.activeTimeoutTeam = p.team;
      s.rallyPhase = "TIMEOUT_ACTIVE";
      return s;

    case "TIMEOUT_END":
      s.activeTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "TTO_START":
      s.ttoActive = true;
      if (s.sets[setIdx]) s.sets[setIdx].ttoFired = true;
      s.rallyPhase = "TTO_ACTIVE";
      return s;

    case "TTO_END":
      s.ttoActive = false;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "SIDE_SWITCH":
      if (s.sets[setIdx]) s.sets[setIdx].teamASide = p.newTeamASide;
      return s;

    case "SET_END": {
      const idx = p.setNumber - 1;
      const set = s.sets[idx];
      if (!set) return s;
      // Idempotent: only count the win the first time the set is closed.
      if (!set.winner) {
        if (p.winner === "A") s.setsWonA += 1;
        else s.setsWonB += 1;
      }
      // Imported/synthetic matches with no rally events: trust declared scores.
      if (set.scoreA === 0 && set.scoreB === 0) {
        set.scoreA = p.scoreA;
        set.scoreB = p.scoreB;
      }
      set.winner = p.winner;
      set.endedAt = event.timestamp;
      s.rallyPhase = "SET_BREAK";
      return s;
    }

    case "MATCH_END":
      s.winner = p.winner;
      s.status = "FINISHED";
      s.rallyPhase = "MATCH_OVER";
      return s;

    case "VCS_RESULT":
      // A failed challenge is deducted; a successful one is retained.
      if (!p.upheld && s.sets[setIdx]) {
        if (p.team === "A")
          s.sets[setIdx].challengesRemainingA = Math.max(
            0,
            s.sets[setIdx].challengesRemainingA - 1,
          );
        else
          s.sets[setIdx].challengesRemainingB = Math.max(
            0,
            s.sets[setIdx].challengesRemainingB - 1,
          );
      }
      return s;

    case "VCS_CHALLENGE":
      // Recorded; the outcome (VCS_RESULT) adjusts remaining challenges.
      return s;

    case "DELAY_WARNING":
      if (s.sets[setIdx]) {
        if (p.team === "A")
          s.sets[setIdx].delaySanctionsA = Math.max(
            1,
            s.sets[setIdx].delaySanctionsA,
          );
        else
          s.sets[setIdx].delaySanctionsB = Math.max(
            1,
            s.sets[setIdx].delaySanctionsB,
          );
      }
      return s;

    case "DELAY_PENALTY":
      if (s.sets[setIdx]) {
        if (p.team === "A") s.sets[setIdx].delaySanctionsA += 1;
        else s.sets[setIdx].delaySanctionsB += 1;
      }
      return s;

    case "MEDICAL_TIMEOUT":
      s.medicalTimeoutTeam = p.team;
      s.rallyPhase = "MEDICAL_TIMEOUT_ACTIVE";
      return s;

    case "MEDICAL_TIMEOUT_END":
      s.medicalTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "MISCONDUCT_WARNING":
    case "MISCONDUCT_PENALTY":
    case "MISCONDUCT_EXPULSION":
    case "MISCONDUCT_DISQUALIFICATION": {
      const set = s.sets[setIdx];
      const record = {
        type: p.type,
        playerId: p.playerId,
        setNumber: s.currentSetNumber,
        scoreA: set?.scoreA ?? 0,
        scoreB: set?.scoreB ?? 0,
      };
      if (p.team === "A") s.misconductA.push(record);
      else s.misconductB.push(record);
      return s;
    }

    case "SERVE_CLOCK_EXPIRE":
    case "UNDO":
    case "NOTE":
      return s;

    default:
      return s;
  }
}

// ── auto-emitted events ──────────────────────────────────────────────────────

export function computeSideSwitch(
  set: BeachSetState,
  config: TournamentConfig,
): { newTeamASide: Side } | null {
  if (!isSideSwitchDue(set, config)) return null;
  return { newTeamASide: oppositeSide(set.teamASide) };
}

export function computeTTODue(
  set: BeachSetState,
  config: TournamentConfig,
): boolean {
  return isTTODue(set, config);
}

export function computeSetEnd(
  set: BeachSetState,
  config: TournamentConfig,
): TeamId | null {
  return setWinner(set, config);
}

/**
 * After a scoring event has been applied, return the payloads the engine must
 * auto-emit, in priority order: set end (→ match end) takes precedence; only if
 * the set continues do side switch and TTO apply (side switch before TTO).
 */
export function computeAutoEmits(
  state: BeachMatchState,
  config: TournamentConfig,
): BeachEventPayload[] {
  const set = activeSet(state);
  if (!set || set.winner) return [];

  const winner = computeSetEnd(set, config);
  if (winner) {
    const emits: BeachEventPayload[] = [
      {
        type: "SET_END",
        winner,
        scoreA: set.scoreA,
        scoreB: set.scoreB,
        setNumber: set.setNumber,
      },
    ];
    const setsA = state.setsWonA + (winner === "A" ? 1 : 0);
    const setsB = state.setsWonB + (winner === "B" ? 1 : 0);
    const need = setsNeededToWin(config);
    if (setsA >= need || setsB >= need) {
      emits.push({ type: "MATCH_END", winner, setsA, setsB });
    }
    return emits;
  }

  const emits: BeachEventPayload[] = [];
  const ss = computeSideSwitch(set, config);
  if (ss) emits.push({ type: "SIDE_SWITCH", newTeamASide: ss.newTeamASide });
  if (computeTTODue(set, config)) emits.push({ type: "TTO_START" });
  return emits;
}

// ── append orchestration (pure) ──────────────────────────────────────────────

/** Events whose application can produce auto-emitted consequences. */
function isScoringEvent(type: BeachEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult =
  | { ok: false; reason: string }
  | { ok: true; newEvents: BeachEvent[]; state: BeachMatchState };

/**
 * Apply a new payload to the current state: validate, build the primary event,
 * then append any auto-emitted consequences (only after a scoring event, so a
 * non-scoring event at a side-switch sum cannot re-trigger one). Pure — the
 * caller supplies sequence/timestamp/id and persists `newEvents`.
 */
export function appendBeachEvent(
  prevState: BeachMatchState,
  payload: BeachEventPayload,
  config: TournamentConfig,
  opts: {
    nextSequence: number;
    timestamp: string;
    makeId: (sequence: number) => string;
  },
): AppendResult {
  const validation = validateBeachEvent(payload, prevState, config);
  if (!validation.ok) return { ok: false, reason: validation.reason! };

  let seq = opts.nextSequence;
  const newEvents: BeachEvent[] = [];
  let state = prevState;

  const primary: BeachEvent = {
    id: opts.makeId(seq),
    sequence: seq,
    timestamp: opts.timestamp,
    payload,
  };
  newEvents.push(primary);
  state = reduce(state, primary, config);
  seq += 1;

  if (isScoringEvent(payload.type)) {
    for (const emit of computeAutoEmits(state, config)) {
      const ev: BeachEvent = {
        id: opts.makeId(seq),
        sequence: seq,
        timestamp: opts.timestamp,
        payload: emit,
      };
      newEvents.push(ev);
      state = reduce(state, ev, config);
      seq += 1;
    }
  }

  return { ok: true, newEvents, state };
}

// ── replay ───────────────────────────────────────────────────────────────────

/**
 * Rebuild match state from the full event log. UNDO events remove their target
 * from the replay (UNDO events themselves are never removed). `ttoFired` is
 * derived naturally from the surviving TTO_START events, so a TTO that already
 * fired is not re-emitted after an unrelated rally is undone.
 */
export function replayEvents(
  matchId: string,
  events: BeachEvent[],
  config: TournamentConfig,
): BeachMatchState {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.payload.type === "UNDO") undone.add(ev.payload.targetEventId);
  }

  let state = initialBeachState(matchId);
  for (const ev of events) {
    if (ev.payload.type !== "UNDO" && undone.has(ev.id)) continue;
    state = reduce(state, ev, config);
  }
  return state;
}
