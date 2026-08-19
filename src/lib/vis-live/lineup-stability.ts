/**
 * Hold the six steady while the feed makes up its mind (spec/42).
 *
 * VIS rewrites the `LineUp` attached to an already-recorded rally for some
 * seconds after that rally: measured live on match 27550, the same score and
 * the same rally count returned three different position-1 players inside forty
 * seconds. At the twenty-second cadence the boards used to run at, that had
 * always settled before anyone looked. At one second (spec/37) the board
 * renders every intermediate state, and a server appears, then vanishes — which
 * is exactly what was reported from the hall.
 *
 * So a lineup change is only adopted when it is credible:
 *
 *  - a new rally has been played — the feed is describing something new, take it;
 *  - or the same new six has come back twice running — it has settled.
 *
 * And one change is never adopted: a libero in the serving position. A libero
 * may not serve (FIVB 19.3.2.1), so that reading is always the feed mid-write,
 * whatever else is true.
 *
 * The cost is at most one poll of latency on a rotation, about a second, and
 * only when the feed contradicts itself. The score, the sets and the serving
 * side are untouched by any of this and keep updating immediately.
 */

import type { VisBoardData, VisBoardPlayer } from "./board-data";

interface Held {
  rallies: number;
  /** The six currently on screen, per side. */
  shown: { A: VisBoardPlayer[]; B: VisBoardPlayer[] };
  /** A candidate seen once, waiting to be seen again. */
  pending: { A: string | null; B: string | null };
}

const held = new Map<number, Held>();
const MAX_TRACKED = 200;

const key = (six: VisBoardPlayer[]) => six.map((p) => p.jersey ?? p.name).join(",");

/** Would this side be serving with a libero in position 1? */
function liberoOnServe(board: VisBoardData, side: "A" | "B", six: VisBoardPlayer[]) {
  return board.serving === side && six.length > 0 && six[0].isLibero;
}

/**
 * Returns the board with its line-ups replaced by the stable ones. Mutates
 * nothing the caller owns; the board object itself is rebuilt shallowly.
 */
export function stabiliseLineups(
  matchNo: number,
  board: VisBoardData,
  rallies: number,
): VisBoardData {
  const prev = held.get(matchNo);
  const fresh: Held = {
    rallies,
    shown: { A: board.teamA.players, B: board.teamB.players },
    pending: { A: null, B: null },
  };

  if (!prev || rallies !== prev.rallies) {
    // A new rally (or a new match, or a new set): the feed is describing
    // something that just happened, so take it — unless it is telling us a
    // libero is about to serve, which is never true.
    for (const side of ["A", "B"] as const) {
      const six = side === "A" ? board.teamA.players : board.teamB.players;
      if (prev && six.length > 0 && liberoOnServe(board, side, six)) {
        fresh.shown[side] = prev.shown[side];
      }
    }
    if (held.size > MAX_TRACKED) held.clear();
    held.set(matchNo, fresh);
    return withLineups(board, fresh.shown);
  }

  // Same rally: only adopt a change once it has repeated, and never adopt a
  // libero into the serving position.
  for (const side of ["A", "B"] as const) {
    const incoming = side === "A" ? board.teamA.players : board.teamB.players;
    const shown = prev.shown[side];
    if (incoming.length === 0) {
      fresh.shown[side] = shown;
      continue;
    }
    const k = key(incoming);
    if (k === key(shown)) {
      fresh.shown[side] = shown;
      continue;
    }
    if (liberoOnServe(board, side, incoming)) {
      fresh.shown[side] = shown;
      continue;
    }
    if (prev.pending[side] === k) {
      fresh.shown[side] = incoming; // seen twice: settled
    } else {
      fresh.shown[side] = shown;
      fresh.pending[side] = k;
    }
  }
  held.set(matchNo, fresh);
  return withLineups(board, fresh.shown);
}

function withLineups(
  board: VisBoardData,
  six: { A: VisBoardPlayer[]; B: VisBoardPlayer[] },
): VisBoardData {
  if (six.A === board.teamA.players && six.B === board.teamB.players) return board;
  return {
    ...board,
    teamA: { ...board.teamA, players: six.A },
    teamB: { ...board.teamB, players: six.B },
  };
}

/** Test seam. */
export function __resetLineupStability(): void {
  held.clear();
}
