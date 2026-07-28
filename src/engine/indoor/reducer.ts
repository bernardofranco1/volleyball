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
 * Discipline-agnostic pieces (lifecycle/timeout/sanction cases, win conditions,
 * append/replay orchestration) live in ../core.
 */

import type { TournamentConfig } from "../config";
import {
  applySubstitution,
  clone,
  isCommonPayload,
  reduceCommon,
  swapOnCourt,
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
import type { PendingIndoorLineup } from "./types";
import { validateIndoorEvent } from "./validator";

/** Confirm one team's starting six (+ liberos) on a set — shared by the live
 *  LINEUP_CONFIRMED path and SET_START applying a pre-declared lineup. */
function applyLineup(
  set: IndoorSetState,
  team: TeamId,
  lineup: PendingIndoorLineup,
): void {
  if (team === "A") {
    set.lineupA = [...lineup.playerIds];
    set.courtPositionsA = [...lineup.playerIds];
    set.lineupConfirmedA = true;
    set.libero.liberoIdA = lineup.liberoId;
    set.libero.secondLiberoIdA = lineup.secondLiberoId;
  } else {
    set.lineupB = [...lineup.playerIds];
    set.courtPositionsB = [...lineup.playerIds];
    set.lineupConfirmedB = true;
    set.libero.liberoIdB = lineup.liberoId;
    set.libero.secondLiberoIdB = lineup.secondLiberoId;
  }
}

// ── pure rule predicates (config-driven; shared ones re-exported) ────────────

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
    // The libero rotated with the team; it may not serve or play front row
    // (Rule 19). If it landed in the server slot or front row, it leaves and the
    // player it replaced returns. Deterministic → reproduced on replay.
    enforceLiberoLegality(s, winner);
  }
  return s;
}

// Court positions a libero may legally occupy: back-row, non-server (5 and 6 →
// indices 4 and 5). Index 0 is back-row but is the server (libero can't serve).
function liberoLegalIndex(idx: number): boolean {
  return idx === 4 || idx === 5;
}

function enforceLiberoLegality(set: IndoorSetState, team: TeamId): void {
  const onCourt =
    team === "A" ? set.libero.liberoOnCourtA : set.libero.liberoOnCourtB;
  const liberoId =
    team === "A" ? set.libero.liberoIdA : set.libero.liberoIdB;
  if (!onCourt || !liberoId) return;
  const court = team === "A" ? set.courtPositionsA : set.courtPositionsB;
  const idx = court.indexOf(liberoId);
  if (idx < 0 || liberoLegalIndex(idx)) return;

  const replacing =
    team === "A" ? set.libero.liberoReplacingA : set.libero.liberoReplacingB;
  if (replacing) court[idx] = replacing;
  if (team === "A") {
    set.libero.liberoOnCourtA = false;
    set.libero.liberoReplacingA = null;
    set.libero.lastLiberoRallyA = set.ralliesPlayed;
  } else {
    set.libero.liberoOnCourtB = false;
    set.libero.liberoReplacingB = null;
    set.libero.lastLiberoRallyB = set.ralliesPlayed;
  }
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

  if (isCommonPayload(p)) {
    reduceCommon(s, p, event.timestamp, config);
    return s;
  }

  switch (p.type) {
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
      // Lineups declared during the break/pre-match (stashed below) apply to
      // the set that just started — the paper flow: lineups first.
      for (const team of ["A", "B"] as const) {
        const pending = s.pendingLineups?.[team];
        if (pending) applyLineup(newSet, team, pending);
      }
      s.pendingLineups = null;
      if (newSet.lineupConfirmedA && newSet.lineupConfirmedB)
        s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "LINEUP_CONFIRMED": {
      // No open set → the lineup is for the NEXT set: stash it per team
      // (re-submittable to correct a mistake) without touching the phase;
      // SET_START applies it.
      if (!set || set.winner) {
        s.pendingLineups = {
          ...(s.pendingLineups ?? {}),
          [p.team]: {
            playerIds: [...p.playerIds],
            liberoId: p.liberoId,
            secondLiberoId: p.secondLiberoId,
          },
        };
        return s;
      }
      applyLineup(set, p.team, {
        playerIds: p.playerIds,
        liberoId: p.liberoId,
        secondLiberoId: p.secondLiberoId,
      });
      if (set.lineupConfirmedA && set.lineupConfirmedB)
        s.rallyPhase = "BETWEEN_RALLIES";
      return s;
    }

    case "RALLY_START":
      s.rallyPhase = "RALLY_LIVE";
      return s;

    case "RALLY_WON_A":
    case "RALLY_WON_B": {
      const winner: TeamId = p.type === "RALLY_WON_A" ? "A" : "B";
      if (set) s.sets[setIdx] = applyPoint(set, winner);
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
      applySubstitution(s, set, p, !p.isExceptional);
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

  const end = computeEndEmits(set, state, config);
  if (end) return end;

  // Deciding-set court change at the switch score (no mid-set switches otherwise).
  if (isDecidingSwitchDue(set, config)) {
    return [{ type: "SIDE_SWITCH", newTeamASide: oppositeSide(set.teamASide) }];
  }
  return [];
}

// ── append orchestration & replay (shared chassis) ───────────────────────────

function isScoringEvent(type: IndoorEventPayload["type"]): boolean {
  return type === "RALLY_WON_A" || type === "RALLY_WON_B";
}

export type AppendResult = CoreAppendResult<
  IndoorMatchState,
  IndoorEventPayload
>;

export const appendIndoorEvent = createAppendFn({
  validate: validateIndoorEvent,
  reduce,
  computeAutoEmits,
  isScoringEvent,
});

export const replayEvents = createReplayFn(initialIndoorState, reduce);
