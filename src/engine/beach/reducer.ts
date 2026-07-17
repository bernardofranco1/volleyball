/**
 * Pure rule engine for beach volleyball. `reduce(state, event, config)` is a
 * pure function — no I/O, no side effects. State is rebuilt by replaying the
 * append-only event log (`replayEvents`). Auto-emitted events (SET_END,
 * MATCH_END, SIDE_SWITCH, TTO_START) are computed by `computeAutoEmits` and
 * appended by the API layer after a scoring event.
 *
 * Discipline-agnostic pieces (lifecycle/timeout/sanction cases, win conditions,
 * append/replay orchestration) live in ../core; only beach-specific rules
 * (player-1/2 serve alternation, mid-set side switches, TTO) live here.
 */

import type { TournamentConfig } from "../config";
import {
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

// ── pure rule predicates (config-driven; shared ones re-exported) ────────────

export {
  isSideSwitchDue,
  setsNeededToWin,
  setWinner,
  setWinTarget,
} from "../core/winConditions";

export function isSetWon(set: BeachSetState, config: TournamentConfig): boolean {
  return setWinner(set, config) !== null;
}

/** Technical time-out: once per non-deciding set when the point sum hits the trigger. */
export function isTTODue(set: BeachSetState, config: TournamentConfig): boolean {
  if (!config.ttoEnabled || config.ttoTriggerScore == null) return false;
  if (set.setNumber >= config.bestOf) return false; // no TTO in the deciding set
  if (set.ttoFired) return false;
  return set.scoreA + set.scoreB === config.ttoTriggerScore;
}

// ── helpers ──────────────────────────────────────────────────────────────────

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
    // Slot→player binding is declared per set (SERVICE_ORDER), never carried over.
    firstServerPlayerIdA: null,
    firstServerPlayerIdB: null,
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

  if (isCommonPayload(p)) {
    reduceCommon(s, p, event.timestamp);
    return s;
  }

  switch (p.type) {
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

    case "SERVICE_ORDER": {
      const set = s.sets[setIdx];
      if (set) {
        if (p.team === "A") set.firstServerPlayerIdA = p.firstServerPlayerId;
        else set.firstServerPlayerIdB = p.firstServerPlayerId;
      }
      return s;
    }

    case "RALLY_WON_A":
    case "RALLY_WON_B": {
      const winner: TeamId = p.type === "RALLY_WON_A" ? "A" : "B";
      if (s.sets[setIdx]) s.sets[setIdx] = applyPoint(s.sets[setIdx], winner);
      s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

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

  const end = computeEndEmits(set, state, config);
  if (end) return end;

  const emits: BeachEventPayload[] = [];
  const ss = computeSideSwitch(set, config);
  if (ss) emits.push({ type: "SIDE_SWITCH", newTeamASide: ss.newTeamASide });
  if (computeTTODue(set, config)) emits.push({ type: "TTO_START" });
  return emits;
}

// ── append orchestration & replay (shared chassis) ───────────────────────────

/** Events whose application can produce auto-emitted consequences. */
function isScoringEvent(type: BeachEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult = CoreAppendResult<BeachMatchState, BeachEventPayload>;

export const appendBeachEvent = createAppendFn({
  validate: validateBeachEvent,
  reduce,
  computeAutoEmits,
  isScoringEvent,
});

export const replayEvents = createReplayFn(initialBeachState, reduce);
