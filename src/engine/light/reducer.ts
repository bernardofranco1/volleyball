/**
 * Pure rule engine for Light Volleyball (4v4 / 5v5). Grass-style rotation/lineup/
 * subs with indoor-style switching (no mid-set side switches; the deciding set
 * changes ends at 8). Two scorer-called faults (jump-serve foot fault, front-zone
 * attack arc fault) award the rally to the opponent.
 *
 * Discipline-agnostic pieces (lifecycle/timeout/sanction cases, win conditions,
 * append/replay orchestration) live in ../core.
 */

import type { TournamentConfig } from "../config";
import {
  applySubstitution,
  clone,
  isCommonPayload,
  reduceCommon,
} from "../core/baseReducer";
import {
  type AppendResult as CoreAppendResult,
  createAppendFn,
  createReplayFn,
} from "../core/factories";
import {
  computeEndEmits,
  isDecidingSwitchDue,
  setWinner,
} from "../core/winConditions";
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

// ── pure rule predicates (shared ones re-exported) ───────────────────────────

export {
  isDecidingSwitchDue,
  setsNeededToWin,
  setWinner,
  setWinTarget,
} from "../core/winConditions";

// ── helpers ──────────────────────────────────────────────────────────────────

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
  if (winner === "A") s.scoreA += 1;
  else s.scoreB += 1;

  // Air/Light: the team that wins the rally ALWAYS rotates clockwise and serves
  // next — including when it was already serving (FIVB Light Volleyball rule;
  // brief §7 / Appendix A, confirmed by the product owner). This differs from
  // indoor/beach, where the server continues on a won rally. A team's first
  // service in a set uses index 0; every subsequent win advances one position.
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
  return s;
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

  if (isCommonPayload(p)) {
    reduceCommon(s, p, event.timestamp, config);
    return s;
  }

  switch (p.type) {
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

    case "SIDE_SWITCH":
      if (set) {
        set.teamASide = p.newTeamASide;
        set.decidingSwitchDone = true;
      }
      return s;

    case "SUBSTITUTION": {
      if (!set) return s;
      applySubstitution(s, set, p, !p.isEmergency);
      return s;
    }

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

  const end = computeEndEmits(set, state, config);
  if (end) return end;

  if (isDecidingSwitchDue(set, config))
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  return [];
}

// ── append orchestration & replay (shared chassis) ───────────────────────────

function isScoringEvent(type: LightEventPayload["type"]): boolean {
  return (
    type === "RALLY_WON_A" ||
    type === "RALLY_WON_B" ||
    type === "JUMP_SERVE_FOOT_FAULT" ||
    type === "ATTACK_ARC_FAULT"
  );
}

export type AppendResult = CoreAppendResult<LightMatchState, LightEventPayload>;

export const appendLightEvent = createAppendFn({
  validate: validateLightEvent,
  reduce,
  computeAutoEmits,
  isScoringEvent,
});

export const replayEvents = createReplayFn(initialLightState, reduce);
