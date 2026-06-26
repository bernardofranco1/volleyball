/**
 * Pure rule engine for indoor volleyball. Mirrors the beach engine's shape:
 * `reduce(state, event, config)` is pure; state is rebuilt by replaying the
 * append-only log (`replayEvents`). Auto-emitted events (SET_END, MATCH_END, and
 * the deciding-set SIDE_SWITCH at 8) are computed by `computeAutoEmits` and
 * appended by the API layer after a scoring event.
 *
 * Indoor specifics vs beach: 6-player rotation, substitutions with slot tracking
 * (Rule 15.6), libero replacements (Rule 19), VCS review phase, lineup-pending
 * gate before each set, and no mid-set side switches (decider changes ends at 8).
 */

import type { TournamentConfig } from "../config";
import {
  type IndoorEvent,
  type IndoorEventPayload,
  type IndoorMatchState,
  type IndoorSetState,
  type SetNumber,
  type Side,
  type TeamId,
  activeSet,
  initialIndoorState,
  oppositeSide,
  rotateClockwise,
} from "./types";
import { validateIndoorEvent } from "./validator";

// ── pure rule predicates (config-driven) ─────────────────────────────────────

export function setWinTarget(
  setNumber: SetNumber,
  config: TournamentConfig,
): number {
  return setNumber >= config.bestOf ? config.setScoreTiebreak : config.setScore;
}

export function setWinner(
  set: IndoorSetState,
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

/** Decider court change (Rule 18.2): leading team has reached the switch score. */
export function isDecidingSwitchDue(
  set: IndoorSetState,
  config: TournamentConfig,
): boolean {
  if (set.setNumber < config.bestOf) return false; // only the deciding set
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
  config: TournamentConfig,
): IndoorSetState {
  const challenges = config.vcsEnabled
    ? setNumber >= config.bestOf
      ? 1 // deciding set: one challenge per team
      : config.vcsChallengesPerSet
    : 0;
  return {
    setNumber,
    scoreA: 0,
    scoreB: 0,
    teamAStartSide,
    teamASide: teamAStartSide,
    firstServer,
    currentServer: firstServer,
    rotationIndexA: 0,
    rotationIndexB: 0,
    lineupA: [],
    lineupB: [],
    lineupConfirmedA: false,
    lineupConfirmedB: false,
    courtPositionsA: [],
    courtPositionsB: [],
    timeoutsUsedA: 0,
    timeoutsUsedB: 0,
    subsUsedA: 0,
    subsUsedB: 0,
    subSlotsA: {},
    subSlotsB: {},
    libero: {
      liberoIdA: null,
      liberoIdB: null,
      secondLiberoIdA: null,
      secondLiberoIdB: null,
      liberoReplacingA: null,
      liberoReplacingB: null,
      liberoOnCourtA: false,
      liberoOnCourtB: false,
      lastLiberoRallyA: -1,
      lastLiberoRallyB: -1,
    },
    vcs: {
      challengesRemainingA: challenges,
      challengesRemainingB: challenges,
      activeChallenge: null,
    },
    ralliesPlayed: 0,
    decidingSwitchDone: false,
    delaySanctionsA: 0,
    delaySanctionsB: 0,
    winner: null,
    startedAt: null,
    endedAt: null,
  };
}

/** Apply a won rally: bump score, count the rally, rotate on side-out. */
function applyPoint(set: IndoorSetState, winner: TeamId): IndoorSetState {
  const s = clone(set);
  const wasServing = s.currentServer === winner;
  if (winner === "A") s.scoreA += 1;
  else s.scoreB += 1;
  s.ralliesPlayed += 1;

  if (!wasServing) {
    // Side-out: receiving team gains serve and rotates one position clockwise.
    s.currentServer = winner;
    if (winner === "A") {
      s.rotationIndexA = (s.rotationIndexA + 1) % 6;
      s.courtPositionsA = rotateClockwise(s.courtPositionsA);
    } else {
      s.rotationIndexB = (s.rotationIndexB + 1) % 6;
      s.courtPositionsB = rotateClockwise(s.courtPositionsB);
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
  state: IndoorMatchState,
  event: IndoorEvent,
  config: TournamentConfig,
): IndoorMatchState {
  const s = clone(state);
  const p = event.payload;
  s.lastSequence = event.sequence;
  const setIdx = s.currentSetNumber - 1;
  const set = s.sets[setIdx];

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
      const newSet = newSetState(
        p.setNumber,
        p.firstServer,
        p.teamAStartSide,
        config,
      );
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
      if (p.team === "A") {
        set.lineupA = [...p.playerIds];
        set.courtPositionsA = [...p.playerIds];
        set.lineupConfirmedA = true;
        set.libero.liberoIdA = p.liberoId;
        set.libero.secondLiberoIdA = p.secondLiberoId;
      } else {
        set.lineupB = [...p.playerIds];
        set.courtPositionsB = [...p.playerIds];
        set.lineupConfirmedB = true;
        set.libero.liberoIdB = p.liberoId;
        set.libero.secondLiberoIdB = p.secondLiberoId;
      }
      if (set.lineupConfirmedA && set.lineupConfirmedB)
        s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "RALLY_WON_A":
    case "RALLY_WON_B": {
      const winner: TeamId = p.type === "RALLY_WON_A" ? "A" : "B";
      if (set) s.sets[setIdx] = applyPoint(set, winner);
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
        slots[p.outPlayerId] = p.inPlayerId; // open the slot
      } else {
        // returning starter → exhaust the slot
        const starter = Object.keys(slots).find(
          (k) => slots[k] === p.outPlayerId,
        );
        if (starter) slots[starter] = null;
      }
      swapOnCourt(court, p.outPlayerId, p.inPlayerId);

      if (!p.isExceptional) {
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

    case "LIBERO_REPLACEMENT": {
      if (!set) return s;
      const court = p.team === "A" ? set.courtPositionsA : set.courtPositionsB;
      if (p.direction === "IN") {
        swapOnCourt(court, p.outPlayerId, p.liberoId);
        if (p.team === "A") {
          set.libero.liberoOnCourtA = true;
          set.libero.liberoReplacingA = p.outPlayerId;
          set.libero.lastLiberoRallyA = set.ralliesPlayed;
        } else {
          set.libero.liberoOnCourtB = true;
          set.libero.liberoReplacingB = p.outPlayerId;
          set.libero.lastLiberoRallyB = set.ralliesPlayed;
        }
      } else {
        // OUT: the replaced back-row player returns for the libero.
        const returning =
          p.team === "A"
            ? set.libero.liberoReplacingA
            : set.libero.liberoReplacingB;
        if (returning) swapOnCourt(court, p.liberoId, returning);
        if (p.team === "A") {
          set.libero.liberoOnCourtA = false;
          set.libero.liberoReplacingA = null;
          set.libero.lastLiberoRallyA = set.ralliesPlayed;
        } else {
          set.libero.liberoOnCourtB = false;
          set.libero.liberoReplacingB = null;
          set.libero.lastLiberoRallyB = set.ralliesPlayed;
        }
      }
      return s;
    }

    case "LIBERO_REDESIGNATION":
      if (set) {
        if (p.team === "A") set.libero.liberoIdA = p.newLiberoId;
        else set.libero.liberoIdB = p.newLiberoId;
      }
      return s;

    case "VCS_CHALLENGE":
      if (set)
        set.vcs.activeChallenge = { team: p.team, requestSeq: event.sequence };
      s.rallyPhase = "VCS_ACTIVE";
      return s;

    case "VCS_RESULT":
      if (set) {
        if (!p.upheld) {
          if (p.team === "A")
            set.vcs.challengesRemainingA = Math.max(
              0,
              set.vcs.challengesRemainingA - 1,
            );
          else
            set.vcs.challengesRemainingB = Math.max(
              0,
              set.vcs.challengesRemainingB - 1,
            );
        }
        set.vcs.activeChallenge = null;
      }
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;

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
  set: IndoorSetState,
  config: TournamentConfig,
): TeamId | null {
  return setWinner(set, config);
}

export function computeAutoEmits(
  state: IndoorMatchState,
  config: TournamentConfig,
): IndoorEventPayload[] {
  const set = activeSet(state);
  if (!set || set.winner) return [];

  const winner = computeSetEnd(set, config);
  if (winner) {
    const emits: IndoorEventPayload[] = [
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

  // Deciding-set court change at the switch score (no mid-set switches otherwise).
  if (isDecidingSwitchDue(set, config)) {
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  }
  return [];
}

// ── append orchestration (pure) ──────────────────────────────────────────────

function isScoringEvent(type: IndoorEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult =
  | { ok: false; reason: string }
  | { ok: true; newEvents: IndoorEvent[]; state: IndoorMatchState };

export function appendIndoorEvent(
  prevState: IndoorMatchState,
  payload: IndoorEventPayload,
  config: TournamentConfig,
  opts: {
    nextSequence: number;
    timestamp: string;
    makeId: (sequence: number) => string;
  },
): AppendResult {
  const validation = validateIndoorEvent(payload, prevState, config);
  if (!validation.ok) return { ok: false, reason: validation.reason! };

  let seq = opts.nextSequence;
  const newEvents: IndoorEvent[] = [];
  let state = prevState;

  const primary: IndoorEvent = {
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
      const ev: IndoorEvent = {
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
  events: IndoorEvent[],
  config: TournamentConfig,
): IndoorMatchState {
  const undone = new Set<string>();
  for (const ev of events) {
    if (ev.payload.type === "UNDO") undone.add(ev.payload.targetEventId);
  }
  let state = initialIndoorState(matchId);
  for (const ev of events) {
    if (ev.payload.type !== "UNDO" && undone.has(ev.id)) continue;
    state = reduce(state, ev, config);
  }
  return state;
}
