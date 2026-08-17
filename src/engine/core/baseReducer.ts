// The reducer "chassis" shared by all four discipline reducers: the event
// cases whose handling is byte-identical (match lifecycle, timeouts, sanctions,
// misconduct, set/match end, no-ops) plus small state helpers.
//
// Structural typing throughout: `reduceCommon` mutates a `CommonMatchState`
// view of the (already-cloned) discipline state, so each discipline's concrete
// state satisfies it without casts. Discipline-specific cases (rallies, VCS,
// libero, lineups, side switches, TTO, …) stay in the discipline reducers.

import type { MisconductRecord, SetNumber, Side, TeamId } from "../types";
import type { TournamentConfig } from "../config";
import { setWinTarget, setsNeededToWin } from "./winConditions";

// ── shared helpers ───────────────────────────────────────────────────────────

export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Replace `outId` with `inId` in a court-positions array (in place). */
export function swapOnCourt(court: string[], outId: string, inId: string): void {
  const idx = court.indexOf(outId);
  if (idx >= 0) court[idx] = inId;
}

// ── structural state shapes the common cases touch ──────────────────────────

export type CommonMatchStatus =
  | "SETUP"
  | "COIN_TOSS"
  | "READY"
  | "LIVE"
  | "FINISHED";

/** Rally phases every discipline shares (each adds its own on top). */
export type CommonRallyPhase =
  | "IDLE"
  | "BETWEEN_RALLIES"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";

export interface CommonSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  delaySanctionsA: number;
  delaySanctionsB: number;
  winner: TeamId | null;
  endedAt: string | null;
}

export interface CommonMatchState<Phase extends string = CommonRallyPhase> {
  status: CommonMatchStatus;
  rallyPhase: Phase;
  currentSetNumber: SetNumber;
  sets: CommonSetState[];
  setsWonA: number;
  setsWonB: number;
  set1FirstServer: TeamId | null;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  medicalTimeoutTeam: TeamId | null;
  /** Event timestamp of the active team time-out (drives the countdown), or null. */
  activeTimeoutStartedAt?: string | null;
  /** Event timestamp when the current set break began (drives the countdown). */
  setBreakStartedAt?: string | null;
  matchStartedAt: string | null;
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
  /**
   * How many medical recoveries each player has taken this match (spec/29
   * F11), keyed by roster-row id. Optional: snapshots written before this
   * existed simply have none, and replay rebuilds it.
   */
  recoveriesByPlayer?: Record<string, number>;
}

// ── the event payloads every discipline handles identically ─────────────────

export type CommonEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  // `tossWinner` (spec/21): which team won the toss — printed on the official
  // scoresheet ("Winner of Coin Toss"). Optional for replay compatibility.
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side; tossWinner?: TeamId }
  | { type: "MATCH_START" }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | {
      type: "SET_END";
      winner: TeamId;
      scoreA: number;
      scoreB: number;
      setNumber: SetNumber;
    }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
  // `team` forfeits/retires; the opponent wins the match (FIVB rule 6.4).
  // FORFEIT = default (no-show / refusal); RETIREMENT = unable to continue.
  | { type: "FORFEIT"; team: TeamId; reason: ForfeitReason }
  // `team` loses the CURRENT SET only (spec/29 F14): an expelled member leaves
  // them unable to field a complete team for the rest of it (FIVB 7.3.1 —
  // "incomplete team"), so the set is awarded to the opponent and the MATCH
  // continues into the next one. Distinct from FORFEIT, which ends the match.
  //
  // Deliberately NOT modelled as a client-submitted SET_END: that event is
  // auto-emitted only, and accepting it from a client would let one fabricate
  // results (spec/14 §A2). SET_DEFAULT instead adjusts the score the way the
  // rulebook does — the opponent to exactly the score they needed, the
  // defaulting team keeping the points they had — and the ordinary auto-emit
  // pipeline closes the set (and the match, if that was the deciding one)
  // exactly as it would for a set won on court.
  | { type: "SET_DEFAULT"; team: TeamId; reason: SetDefaultReason }
  // `playerId` (spec/29 F11): WHO is being treated. Optional — old logs have
  // none, and a recovery can be called before the player is identified — but
  // the official sheet prints the recovery with the player and the score, and
  // the per-player recovery counts below need it.
  //
  // NOTE (deliberate, spec/29 Phase 4): the counts are recorded and printed,
  // but no LIMIT is enforced here. The per-discipline caps differ (beach: one
  // recovery per player per match; indoor: a 3-minute recovery only when no
  // legal substitution exists) and spec/29 requires them verified against the
  // 2025-2028 rulebooks rather than assumed. Recording first is the safe half.
  | { type: "MEDICAL_TIMEOUT"; team: TeamId; playerId?: string }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "SERVE_CLOCK_EXPIRE" }
  // Improper request (FIVB rule 16.1): rejected without sanction, recorded on
  // the scoresheet only (max one per team per match — UI-enforced). No state
  // effect; the official sheet reads it straight from the log (spec/21).
  | { type: "IMPROPER_REQUEST"; team: TeamId }
  // Positional faults (spec/29 F13). Both are MARKERS: they record what was
  // whistled and where, and score nothing by themselves — the point the fault
  // awards is dispatched as an ordinary rally event carrying `causedBy`, the
  // same pattern as a penalty point (F14). Keeping them scoreless is what lets
  // late discovery work: cancelling the points scored while a team was at
  // fault is a batch of targeted UNDOs over ordinary rallies, with nothing
  // bespoke to unwind.
  //
  // ROTATION_FAULT is the rotation disciplines' (indoor/grass/light) wrong
  // position at service; SERVICE_ORDER_FAULT is beach's wrong server. The
  // validators gate each on `config.rotationEnabled` rather than on the
  // discipline name.
  | { type: "ROTATION_FAULT"; team: TeamId; note?: string }
  | { type: "SERVICE_ORDER_FAULT"; team: TeamId; note?: string }
  // `scope` is a request-time hint only (never persisted): "point" asks the
  // server to sweep set-start bookkeeping and undo the last real action in one
  // batch; absent/"single" keeps the one-event-at-a-time behaviour.
  | { type: "UNDO"; targetEventId: string; scope?: UndoScope }
  | { type: "NOTE"; text: string };

/** How far a client-requested UNDO reaches (see selectUndoTargets). */
export type UndoScope = "single" | "point";

/** Why a team's match ended early (FIVB 6.4.2 default / 6.4.3 retirement). */
export type ForfeitReason = "FORFEIT" | "RETIREMENT";

/** Why a team lost one set without playing it out (spec/29 F14). */
export type SetDefaultReason = "INCOMPLETE_TEAM" | "OTHER";

const COMMON_EVENT_TYPES: ReadonlySet<string> = new Set<
  CommonEventPayload["type"]
>([
  "MATCH_CREATED",
  "COIN_TOSS",
  "MATCH_START",
  "REPLAY_POINT",
  "TIMEOUT_REQUEST",
  "TIMEOUT_END",
  "SET_END",
  "MATCH_END",
  "FORFEIT",
  "SET_DEFAULT",
  "MEDICAL_TIMEOUT",
  "MEDICAL_TIMEOUT_END",
  "DELAY_WARNING",
  "DELAY_PENALTY",
  "MISCONDUCT_WARNING",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
  "SERVE_CLOCK_EXPIRE",
  "IMPROPER_REQUEST",
  "ROTATION_FAULT",
  "SERVICE_ORDER_FAULT",
  "UNDO",
  "NOTE",
]);

/** Type guard: is this a payload the shared chassis handles? */
export function isCommonPayload(p: { type: string }): p is CommonEventPayload {
  return COMMON_EVENT_TYPES.has(p.type);
}

/**
 * Apply a common event to the (already-cloned) discipline state, mutating it.
 * The caller has already set `lastSequence`; this handles the rest of the case.
 */
export function reduceCommon<Phase extends string>(
  s: CommonMatchState<Phase | CommonRallyPhase>,
  p: CommonEventPayload,
  timestamp: string,
  config: TournamentConfig,
): void {
  const set = s.sets[s.currentSetNumber - 1];

  switch (p.type) {
    case "MATCH_CREATED":
      s.status = "COIN_TOSS";
      return;

    case "COIN_TOSS":
      s.status = "READY";
      s.set1FirstServer = p.firstServer;
      return;

    case "MATCH_START":
      s.status = "LIVE";
      s.matchStartedAt = timestamp;
      return;

    case "REPLAY_POINT":
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "TIMEOUT_REQUEST":
      if (set) {
        if (p.team === "A") set.timeoutsUsedA += 1;
        else set.timeoutsUsedB += 1;
      }
      s.activeTimeoutTeam = p.team;
      s.activeTimeoutStartedAt = timestamp;
      s.rallyPhase = "TIMEOUT_ACTIVE";
      return;

    case "TIMEOUT_END":
      s.activeTimeoutTeam = null;
      s.activeTimeoutStartedAt = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "SET_END": {
      const target = s.sets[p.setNumber - 1];
      if (!target) return;
      // Idempotent: only count the win the first time the set is closed.
      if (!target.winner) {
        if (p.winner === "A") s.setsWonA += 1;
        else s.setsWonB += 1;
      }
      // Imported/synthetic matches with no rally events: trust declared scores.
      if (target.scoreA === 0 && target.scoreB === 0) {
        target.scoreA = p.scoreA;
        target.scoreB = p.scoreB;
      }
      target.winner = p.winner;
      target.endedAt = timestamp;
      s.rallyPhase = "SET_BREAK";
      s.setBreakStartedAt = timestamp;
      return;
    }

    case "MATCH_END":
      s.winner = p.winner;
      s.status = "FINISHED";
      s.rallyPhase = "MATCH_OVER";
      return;

    case "FORFEIT": {
      // FIVB rule 6.4: the opponent wins. Points/sets already scored are kept
      // (6.4.3 retirement); the open set closes with the opponent raised to
      // exactly what they needed to win it, and the winner's sets tally jumps
      // to the match-winning count. Unplayed sets are not materialized — the
      // event itself records the forfeit in the log and on the report.
      const winner: TeamId = p.team === "A" ? "B" : "A";
      if (set && !set.winner) {
        const target = setWinTarget(set.setNumber, config);
        const lead = config.twoPointLead ? 2 : 1;
        if (winner === "A")
          set.scoreA = Math.max(set.scoreA, target, set.scoreB + lead);
        else set.scoreB = Math.max(set.scoreB, target, set.scoreA + lead);
        set.winner = winner;
        set.endedAt = timestamp;
        if (winner === "A") s.setsWonA += 1;
        else s.setsWonB += 1;
      }
      const need = setsNeededToWin(config);
      if (winner === "A") s.setsWonA = Math.max(s.setsWonA, need);
      else s.setsWonB = Math.max(s.setsWonB, need);
      s.winner = winner;
      s.status = "FINISHED";
      s.rallyPhase = "MATCH_OVER";
      // Clear any live interruption the forfeit landed in.
      s.activeTimeoutTeam = null;
      s.activeTimeoutStartedAt = null;
      s.medicalTimeoutTeam = null;
      return;
    }

    case "SET_DEFAULT": {
      // Award the open set to the opponent, then get out of the way: the
      // caller's auto-emit pass sees a set with a winning score and emits the
      // usual SET_END (+ MATCH_END when it was the deciding set), so set
      // tallies, phases, snapshots and backups all behave normally.
      if (!set || set.winner) return;
      const winner: TeamId = p.team === "A" ? "B" : "A";
      const target = setWinTarget(set.setNumber, config);
      const lead = config.twoPointLead ? 2 : 1;
      if (winner === "A")
        set.scoreA = Math.max(set.scoreA, target, set.scoreB + lead);
      else set.scoreB = Math.max(set.scoreB, target, set.scoreA + lead);
      // Any interruption the default landed in is over.
      s.activeTimeoutTeam = null;
      s.activeTimeoutStartedAt = null;
      s.medicalTimeoutTeam = null;
      return;
    }

    case "MEDICAL_TIMEOUT":
      s.medicalTimeoutTeam = p.team;
      s.rallyPhase = "MEDICAL_TIMEOUT_ACTIVE";
      // Per-player recovery tally (spec/29 F11), for the console to show and
      // the sheet to print. Optional on the state shape so old snapshots (which
      // have no such field) keep replaying.
      if (p.playerId && s.recoveriesByPlayer) {
        s.recoveriesByPlayer[p.playerId] =
          (s.recoveriesByPlayer[p.playerId] ?? 0) + 1;
      } else if (p.playerId) {
        s.recoveriesByPlayer = { [p.playerId]: 1 };
      }
      return;

    case "MEDICAL_TIMEOUT_END":
      s.medicalTimeoutTeam = null;
      s.rallyPhase = "BETWEEN_RALLIES";
      return;

    case "DELAY_WARNING":
      if (set) {
        if (p.team === "A")
          set.delaySanctionsA = Math.max(1, set.delaySanctionsA);
        else set.delaySanctionsB = Math.max(1, set.delaySanctionsB);
      }
      return;

    case "DELAY_PENALTY":
      if (set) {
        if (p.team === "A") set.delaySanctionsA += 1;
        else set.delaySanctionsB += 1;
      }
      return;

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
      return;
    }

    case "SERVE_CLOCK_EXPIRE":
    case "IMPROPER_REQUEST":
    // Markers: recorded in the log, printed on the sheet, no state effect.
    case "ROTATION_FAULT":
    case "SERVICE_ORDER_FAULT":
    case "UNDO":
    case "NOTE":
      return;
  }
}

// ── substitution (identical in indoor/grass/light; the payload key differs) ──

export interface SubstitutionSetState {
  lineupA: string[];
  lineupB: string[];
  courtPositionsA: string[];
  courtPositionsB: string[];
  subsUsedA: number;
  subsUsedB: number;
  subSlotsA: Record<string, string | null>;
  subSlotsB: Record<string, string | null>;
}

/**
 * Apply a substitution with slot tracking (Rule 15.6 model), mutating state.
 * `counted` is false for exceptional/emergency subs — the discipline reducer
 * derives it from its own payload key (isExceptional vs isEmergency), which
 * stays untouched for replay compatibility.
 */
export function applySubstitution(
  s: { totalMatchSubsA: number; totalMatchSubsB: number },
  set: SubstitutionSetState,
  p: { team: TeamId; outPlayerId: string; inPlayerId: string },
  counted: boolean,
): void {
  const court = p.team === "A" ? set.courtPositionsA : set.courtPositionsB;
  const slots = p.team === "A" ? set.subSlotsA : set.subSlotsB;
  const lineup = p.team === "A" ? set.lineupA : set.lineupB;

  const outIsStarter = lineup.includes(p.outPlayerId);
  if (outIsStarter && slots[p.outPlayerId] === undefined) {
    slots[p.outPlayerId] = p.inPlayerId; // open the slot
  } else {
    // returning starter → exhaust the slot
    const starter = Object.keys(slots).find((k) => slots[k] === p.outPlayerId);
    if (starter) slots[starter] = null;
  }
  swapOnCourt(court, p.outPlayerId, p.inPlayerId);

  if (counted) {
    if (p.team === "A") {
      set.subsUsedA += 1;
      s.totalMatchSubsA += 1;
    } else {
      set.subsUsedB += 1;
      s.totalMatchSubsB += 1;
    }
  }
}
