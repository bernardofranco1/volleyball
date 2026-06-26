/**
 * Pure rule engine for Light Volleyball (4v4 / 5v5). Grass-style rotation/lineup/
 * subs with indoor-style switching (no mid-set side switches; the deciding set
 * changes ends at 8). Two scorer-called faults (jump-serve foot fault, front-zone
 * attack arc fault) award the rally to the opponent.
 */

import type { TournamentConfig } from "../config";
import {
  type LightEvent,
  type LightEventPayload,
  type LightMatchState,
  type LightSetState,
  type SetNumber,
  type Side,
  type TeamId,
  activeSet,
  initialLightState,
  oppositeSide,
  oppositeTeam,
} from "./types";
import { validateLightEvent } from "./validator";

// ── pure rule predicates ─────────────────────────────────────────────────────

export function setWinTarget(
  setNumber: SetNumber,
  config: TournamentConfig,
): number {
  return setNumber >= config.bestOf ? config.setScoreTiebreak : config.setScore;
}

export function setWinner(
  set: LightSetState,
  config: TournamentConfig,
): TeamId | null {
  const target = setWinTarget(set.setNumber, config);
  const lead = config.twoPointLead ? 2 : 1;
  if (set.scoreA >= target && set.scoreA - set.scoreB >= lead) return "A";
  if (set.scoreB >= target && set.scoreB - set.scoreA >= lead) return "B";
  return null;
}

export function setsNeededToWin(config: TournamentConfig): number {
  return Math.floor(config.bestOf / 2) + 1;
}

export function isDecidingSwitchDue(
  set: LightSetState,
  config: TournamentConfig,
): boolean {
  if (set.setNumber < config.bestOf) return false;
  if (config.sideSwitchDecidingSetAt == null) return false;
  if (set.decidingSwitchDone) return false;
  return (
    Math.max(set.scoreA, set.scoreB) >= config.sideSwitchDecidingSetAt &&
    set.scoreA + set.scoreB > 0
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  return structuredClone(value);
}

function newSetState(
  setNumber: SetNumber,
  firstServer: TeamId,
  teamAStartSide: Side,
): LightSetState {
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
    lastRotA: firstServer === "A" ? 0 : null,
    lastRotB: firstServer === "B" ? 0 : null,
    timeoutsUsedA: 0,
    timeoutsUsedB: 0,
    subsUsedA: 0,
    subsUsedB: 0,
    subSlotsA: {},
    subSlotsB: {},
    decidingSwitchDone: false,
    delaySanctionsA: 0,
    delaySanctionsB: 0,
    winner: null,
    startedAt: null,
    endedAt: null,
  };
}

function applyPoint(set: LightSetState, winner: TeamId, n: number): LightSetState {
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
  state: LightMatchState,
  event: LightEvent,
  config: TournamentConfig,
): LightMatchState {
  const s = clone(state);
  s.playersPerSide = config.playersPerSide;
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

    case "JUMP_SERVE_FOOT_FAULT":
    case "ATTACK_ARC_FAULT": {
      // The named team committed the fault → the opponent scores and serves.
      if (set) s.sets[setIdx] = applyPoint(set, oppositeTeam(p.team), n);
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
      if (set) {
        set.teamASide = p.newTeamASide;
        set.decidingSwitchDone = true;
      }
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
  set: LightSetState,
  config: TournamentConfig,
): TeamId | null {
  return setWinner(set, config);
}

export function computeAutoEmits(
  state: LightMatchState,
  config: TournamentConfig,
): LightEventPayload[] {
  const set = activeSet(state);
  if (!set || set.winner) return [];

  const winner = computeSetEnd(set, config);
  if (winner) {
    const emits: LightEventPayload[] = [
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

  if (isDecidingSwitchDue(set, config))
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  return [];
}

// ── append orchestration (pure) ──────────────────────────────────────────────

function isScoringEvent(type: LightEventPayload["type"]): boolean {
  return (
    type === "RALLY_WON_A" ||
    type === "RALLY_WON_B" ||
    type === "JUMP_SERVE_FOOT_FAULT" ||
    type === "ATTACK_ARC_FAULT"
  );
}

export type AppendResult =
  | { ok: false; reason: string }
  | { ok: true; newEvents: LightEvent[]; state: LightMatchState };

export function appendLightEvent(
  prevState: LightMatchState,
  payload: LightEventPayload,
  config: TournamentConfig,
  opts: {
    nextSequence: number;
    timestamp: string;
    makeId: (sequence: number) => string;
  },
): AppendResult {
  const validation = validateLightEvent(payload, prevState, config);
  if (!validation.ok) return { ok: false, reason: validation.reason! };

  let seq = opts.nextSequence;
  const newEvents: LightEvent[] = [];
  let state = prevState;

  const primary: LightEvent = {
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
      const ev: LightEvent = {
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
  events: LightEvent[],
  config: TournamentConfig,
): LightMatchState {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.payload.type === "UNDO") undone.add(ev.payload.targetEventId);
  }
  let state = initialLightState(matchId);
  for (const ev of events) {
    if (ev.payload.type !== "UNDO" && undone.has(ev.id)) continue;
    state = reduce(state, ev, config);
  }
  return state;
}
