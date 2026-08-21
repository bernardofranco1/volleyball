/**
 * What the TV graphics need that the feed does not state (spec/47).
 *
 * Pure functions over VisBoardData. Two jobs: turn A/B into the physical left
 * and right of the picture, and work out whether the next point wins a set or
 * the match.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";

/** FIVB indoor: best of five, 25 a set, 15 in the deciding set, win by two. */
const SETS_TO_WIN_MATCH = 3;
const TARGET_NORMAL = 25;
const TARGET_DECIDER = 15;
const DECIDING_SET = 5;

export type Side = "A" | "B";
export type Hand = "left" | "right";

/**
 * Which feed side stands on which side of the picture.
 *
 * `teamAAtLeft` comes from the set's own `NoTeamAtLeft`, so it follows the
 * mid-match side switch. When the feed does not say — before the first whistle,
 * or on a payload that omits it — A goes left. That is a guess, but it is the
 * same guess the U-shape board makes, and having the bug agree with the board on
 * the same match matters more than either being right about a match that has not
 * started.
 */
export function handOf(board: VisBoardData): Record<Hand, Side> {
  const aLeft = board.teamAAtLeft ?? true;
  return aLeft ? { left: "A", right: "B" } : { left: "B", right: "A" };
}

/** The score, sets, serve and interruption counts for one feed side. */
export function sideState(board: VisBoardData, side: Side) {
  const team = side === "A" ? board.teamA : board.teamB;
  return {
    code: team.code,
    name: team.name,
    score: side === "A" ? board.scoreA : board.scoreB,
    sets: side === "A" ? board.setsWonA : board.setsWonB,
    serving: board.serving === side,
    timeoutsTaken: team.timeoutsTaken,
  };
}

/** Points needed to take the set in progress. */
export function setTarget(board: VisBoardData): number {
  return board.currentSet === DECIDING_SET ? TARGET_DECIDER : TARGET_NORMAL;
}

export type KeyMoment = "SET POINT" | "MATCH POINT";

/**
 * The strap for one side, or null.
 *
 * "One more point takes the set" is the whole rule: at or past one short of the
 * target, and at least one clear of the opponent — which is what makes 24-24 no
 * one's set point and 25-24 one side's. If that set would be their third, it is
 * match point instead.
 *
 * Deliberately silent unless the match is LIVE and a set is actually in
 * progress. A set break sits at 25-23 with the feed still reporting it, and
 * leaving "SET POINT" on screen through the interval would be wrong twice: the
 * set is over, and the next point does not decide it.
 */
export function keyMoment(board: VisBoardData, side: Side): KeyMoment | null {
  if (board.status !== "LIVE" || board.inSetBreak || board.currentSet == null) {
    return null;
  }
  const me = sideState(board, side);
  const them = sideState(board, side === "A" ? "B" : "A");
  const target = setTarget(board);
  const atSetPoint = me.score + 1 >= target && me.score + 1 - them.score >= 2;
  if (!atSetPoint) return null;
  return me.sets + 1 >= SETS_TO_WIN_MATCH ? "MATCH POINT" : "SET POINT";
}
