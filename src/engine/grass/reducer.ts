/**
 * Pure rule engine for grass volleyball (3v3 / 4v4). Beach scoring + side-switch
 * model with indoor-style rotation/lineup/subs. `reduce` is pure; state is rebuilt
 * by replaying the log. Auto-emitted events (SET_END, MATCH_END, SIDE_SWITCH at the
 * beach thresholds) are computed by `computeAutoEmits` after a scoring event.
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
  isSideSwitchDue,
  setWinner,
} from "../core/winConditions";
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

// ── pure rule predicates (beach-derived; shared ones re-exported) ────────────

export {
  isSideSwitchDue,
  setsNeededToWin,
  setWinner,
  setWinTarget,
} from "../core/winConditions";

// ── helpers ──────────────────────────────────────────────────────────────────

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

    case "SIDE_SWITCH":
      if (set) set.teamASide = p.newTeamASide;
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

  const end = computeEndEmits(set, state, config);
  if (end) return end;

  if (isSideSwitchDue(set, config))
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  return [];
}

// ── append orchestration & replay (shared chassis) ───────────────────────────

function isScoringEvent(type: GrassEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult = CoreAppendResult<GrassMatchState, GrassEventPayload>;

export const appendGrassEvent = createAppendFn({
  validate: validateGrassEvent,
  reduce,
  computeAutoEmits,
  isScoringEvent,
});

export const replayEvents = createReplayFn(initialGrassState, reduce);
