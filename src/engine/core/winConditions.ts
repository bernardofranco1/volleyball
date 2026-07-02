// Shared win-condition rules (config-driven), identical across all four
// disciplines. Structural typing: functions only see the fields they need, so
// every discipline's set state satisfies `ScoredSet` without casts.

import type { TournamentConfig } from "../config";
import type { SetNumber, TeamId } from "../types";

/** Minimal structural view of a set for scoring/win rules. */
export interface ScoredSet {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
}

/** Points needed to win a set, ignoring the two-point rule. */
export function setWinTarget(
  setNumber: SetNumber,
  config: TournamentConfig,
): number {
  return setNumber >= config.bestOf ? config.setScoreTiebreak : config.setScore;
}

export function setWinner(
  set: ScoredSet,
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

/** Beach/grass side-switch: fires every N total points (7 normal / 5 decider). */
export function isSideSwitchDue(
  set: ScoredSet,
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

/** Indoor/light decider court change: leading team reached the switch score. */
export function isDecidingSwitchDue(
  set: ScoredSet & { decidingSwitchDone: boolean },
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

// ── SET_END / MATCH_END auto-emits (identical across disciplines) ────────────

export type EndEmitPayload =
  | {
      type: "SET_END";
      winner: TeamId;
      scoreA: number;
      scoreB: number;
      setNumber: SetNumber;
    }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number };

/**
 * If the active set is won, return the SET_END (and, when the match is decided,
 * MATCH_END) payloads to auto-emit. Returns null while the set continues, so
 * the discipline can append its own side-switch/TTO emits.
 */
export function computeEndEmits(
  set: ScoredSet,
  state: { setsWonA: number; setsWonB: number },
  config: TournamentConfig,
): EndEmitPayload[] | null {
  const winner = setWinner(set, config);
  if (!winner) return null;
  const emits: EndEmitPayload[] = [
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
