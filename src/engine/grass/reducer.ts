/**
 * Pure rule engine for grass volleyball (3v3 / 4v4). Beach scoring + side-switch
 * model with indoor-style rotation/lineup/subs. `reduce` is pure; state is rebuilt
 * by replaying the log. Auto-emitted events (SET_END, MATCH_END, SIDE_SWITCH at the
 * beach thresholds) are computed by `computeAutoEmits` after a scoring event.
 */

import type { TournamentConfig } from "../config";
import {
  type GrassEvent,
  type GrassEventPayload,
  type GrassMatchState,
  type GrassSetState,
  type SetNumber,
  type Side,
  type TeamId,
  activeSet,
  initialGrassState,
  oppositeSide,
} from "./types";
import { validateGrassEvent } from "./validator";

// ── pure rule predicates (beach-derived, config-driven) ──────────────────────

export function setWinTarget(
  setNumber: SetNumber,
  config: TournamentConfig,
): number {
  return setNumber >= config.bestOf ? config.setScoreTiebreak : config.setScore;
}

export function setWinner(
  set: GrassSetState,
  config: TournamentConfig,
): TeamId | null {
  const target = setWinTarget(set.setNumber, config);
  const lead = config.twoPointLead ? 2 : 1;
  if (set.scoreA >= target && set.scoreA - set.scoreB >= lead) return "A";
  if (set.scoreB >= target && set.scoreB - set.scoreA >= lead) return "B";
  return null;
}

export function isSideSwitchDue(
  set: GrassSetState,
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
): GrassSetState {
  return {
    setNumber,
    scoreA: 0,
    scoreB: 0,
    teamAStartSide,
    teamASide: teamAStartSide,
    firstServer,
    currentServer: firstServer,
    lineupA: [],
    lineupB: [],
    courtPositionsA: [],
    courtPositionsB: [],
    lineupConfirmed: false,
    rotationIndexA: 0,
    rotationIndexB: 0,
    // The first server begins at rotation 0; the other team hasn't served yet.
    lastRotA: firstServer === "A" ? 0 : null,
    lastRotB: firstServer === "B" ? 0 : null,
    timeoutsUsedA: 0,
    timeoutsUsedB: 0,
    subsUsedA: 0,
    subsUsedB: 0,
    subSlotsA: {},
    subSlotsB: {},
    delaySanctionsA: 0,
    delaySanctionsB: 0,
    winner: null,
    startedAt: null,
    endedAt: null,
  };
}

/** Apply a won rally: bump score; on side-out, gain serve and advance rotation. */
function applyPoint(set: GrassSetState, winner: TeamId, n: number): GrassSetState {
  const s = clone(set);
  const wasServing = s.currentServer === winner;
  if (winner === "A") s.scoreA += 1;
  else s.scoreB += 1;

  if (!wasServing) {
    s.currentServer = winner;
    if (winner === "A") {
      const next = s.lastRotA === null ? 0 : (s.lastRotA + 1) % n;
      s.lastRotA = next;
      s.rotationIndexA = next;
    } else {
      const next = s.lastRotB === null ? 0 : (s.lastRotB + 1) % n;
      s.lastRotB = next;
      s.rotationIndexB = next;
    }
  }
  return s;
}

function swapOnCourt(court: string[], outId: string, inId: string): void {
  const idx = court.indexOf(outId);
  if (idx >= 0) court[idx] = inId;
}

// ── main reducer ─────────────────────────────────────────────────────────────

export function reduce(
  state: GrassMatchState,
  event: GrassEvent,
  config: TournamentConfig,
): GrassMatchState {
  const s = clone(state);
  const p = event.payload;
  s.lastSequence = event.sequence;
  const setIdx = s.currentSetNumber - 1;
  const set = s.sets[setIdx];
  const n = config.playersPerSide;

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
      const newSet = newSetState(p.setNumber, p.firstServer, p.teamAStartSide);
      newSet.startedAt = event.timestamp;
      s.sets[p.setNumber - 1] = newSet;
      s.currentSetNumber = p.setNumber;
      if (p.setNumber === 1) s.set1FirstServer = p.firstServer;
      s.status = "LIVE";
      s.rallyPhase = config.lineupRequired ? "LINEUP_PENDING" : "BETWEEN_RALLIES";
      return s;
    }

    case "LINEUP_CONFIRMED": {
      if (!set) return s;
      set.lineupA = [...p.teamAPlayerIds];
      set.lineupB = [...p.teamBPlayerIds];
      set.courtPositionsA = [...p.teamAPlayerIds];
      set.courtPositionsB = [...p.teamBPlayerIds];
      set.lineupConfirmed = true;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "RALLY_WON_A":
    case "RALLY_WON_B": {
      const winner: TeamId = p.type === "RALLY_WON_A" ? "A" : "B";
      if (set) s.sets[setIdx] = applyPoint(set, winner, n);
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "REPLAY_POINT":
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "TIMEOUT_REQUEST":
      if (set) {
        if (p.team === "A") set.timeoutsUsedA += 1;
        else set.timeoutsUsedB += 1;
      }
      s.activeTimeoutTeam = p.team;
      s.rallyPhase = "TIMEOUT_ACTIVE";
      return s;

    case "TIMEOUT_END":
      s.activeTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "SIDE_SWITCH":
      if (set) set.teamASide = p.newTeamASide;
      return s;

    case "SUBSTITUTION": {
      if (!set) return s;
      const court = p.team === "A" ? set.courtPositionsA : set.courtPositionsB;
      const slots = p.team === "A" ? set.subSlotsA : set.subSlotsB;
      const lineup = p.team === "A" ? set.lineupA : set.lineupB;

      const outIsStarter = lineup.includes(p.outPlayerId);
      if (outIsStarter && slots[p.outPlayerId] === undefined) {
        slots[p.outPlayerId] = p.inPlayerId;
      } else {
        const starter = Object.keys(slots).find(
          (k) => slots[k] === p.outPlayerId,
        );
        if (starter) slots[starter] = null;
      }
      swapOnCourt(court, p.outPlayerId, p.inPlayerId);

      if (!p.isEmergency) {
        if (p.team === "A") {
          set.subsUsedA += 1;
          s.totalMatchSubsA += 1;
        } else {
          set.subsUsedB += 1;
          s.totalMatchSubsB += 1;
        }
      }
      return s;
    }

    case "SET_END": {
      const idx = p.setNumber - 1;
      const target = s.sets[idx];
      if (!target) return s;
      if (!target.winner) {
        if (p.winner === "A") s.setsWonA += 1;
        else s.setsWonB += 1;
      }
      if (target.scoreA === 0 && target.scoreB === 0) {
        target.scoreA = p.scoreA;
        target.scoreB = p.scoreB;
      }
      target.winner = p.winner;
      target.endedAt = event.timestamp;
      s.rallyPhase = "SET_BREAK";
      return s;
    }

    case "MATCH_END":
      s.winner = p.winner;
      s.status = "FINISHED";
      s.rallyPhase = "MATCH_OVER";
      return s;

    case "MEDICAL_TIMEOUT":
      s.medicalTimeoutTeam = p.team;
      s.rallyPhase = "MEDICAL_TIMEOUT_ACTIVE";
      return s;

    case "MEDICAL_TIMEOUT_END":
      s.medicalTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

    case "DELAY_WARNING":
      if (set) {
        if (p.team === "A")
          set.delaySanctionsA = Math.max(1, set.delaySanctionsA);
        else set.delaySanctionsB = Math.max(1, set.delaySanctionsB);
      }
      return s;

    case "DELAY_PENALTY":
      if (set) {
        if (p.team === "A") set.delaySanctionsA += 1;
        else set.delaySanctionsB += 1;
      }
      return s;

    case "MISCONDUCT_WARNING":
    case "MISCONDUCT_PENALTY":
    case "MISCONDUCT_EXPULSION":
    case "MISCONDUCT_DISQUALIFICATION": {
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

export function computeSetEnd(
  set: GrassSetState,
  config: TournamentConfig,
): TeamId | null {
  return setWinner(set, config);
}

export function computeAutoEmits(
  state: GrassMatchState,
  config: TournamentConfig,
): GrassEventPayload[] {
  const set = activeSet(state);
  if (!set || set.winner) return [];

  const winner = computeSetEnd(set, config);
  if (winner) {
    const emits: GrassEventPayload[] = [
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
    if (setsA >= need || setsB >= need)
      emits.push({ type: "MATCH_END", winner, setsA, setsB });
    return emits;
  }

  if (isSideSwitchDue(set, config))
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  return [];
}

// ── append orchestration (pure) ──────────────────────────────────────────────

function isScoringEvent(type: GrassEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult =
  | { ok: false; reason: string }
  | { ok: true; newEvents: GrassEvent[]; state: GrassMatchState };

export function appendGrassEvent(
  prevState: GrassMatchState,
  payload: GrassEventPayload,
  config: TournamentConfig,
  opts: {
    nextSequence: number;
    timestamp: string;
    makeId: (sequence: number) => string;
  },
): AppendResult {
  const validation = validateGrassEvent(payload, prevState, config);
  if (!validation.ok) return { ok: false, reason: validation.reason! };

  let seq = opts.nextSequence;
  const newEvents: GrassEvent[] = [];
  let state = prevState;

  const primary: GrassEvent = {
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
      const ev: GrassEvent = {
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

export function replayEvents(
  matchId: string,
  events: GrassEvent[],
  config: TournamentConfig,
): GrassMatchState {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.payload.type === "UNDO") undone.add(ev.payload.targetEventId);
  }
  let state = initialGrassState(matchId);
  for (const ev of events) {
    if (ev.payload.type !== "UNDO" && undone.has(ev.id)) continue;
    state = reduce(state, ev, config);
  }
  return state;
}
