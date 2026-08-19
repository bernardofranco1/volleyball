/**
 * Holding the six steady while the feed settles (spec/42).
 *
 * The reported symptom was a server appearing and then vanishing. The cause was
 * VIS rewriting an already-recorded rally's lineup for a few seconds, which a
 * one-second board renders in full. These pin the rules that stop it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLineupStability,
  stabiliseLineups,
} from "@/lib/vis-live/lineup-stability";
import type { VisBoardData, VisBoardPlayer } from "@/lib/vis-live/board-data";

const p = (jersey: number, isLibero = false): VisBoardPlayer => ({
  position: 1, jersey, name: `#${jersey}`, points: 0, isLibero,
});
const six = (ns: number[], liberoJersey?: number) =>
  ns.map((n) => p(n, n === liberoJersey));

const board = (a: VisBoardPlayer[], b: VisBoardPlayer[], serving: "A" | "B" = "A") =>
  ({
    matchNo: 1, status: "LIVE", serving,
    teamA: { code: "AAA", name: "A", players: a, timeoutsTaken: 0, substitutionsUsed: 0,
      challengesRefused: 0, challengesRequested: 0, timeoutsRemaining: 2,
      substitutionsRemaining: 6, challengesRemaining: 2 },
    teamB: { code: "BBB", name: "B", players: b, timeoutsTaken: 0, substitutionsUsed: 0,
      challengesRefused: 0, challengesRequested: 0, timeoutsRemaining: 2,
      substitutionsRemaining: 6, challengesRemaining: 2 },
    setsWonA: 0, setsWonB: 0, scoreA: 0, scoreB: 0, currentSet: 1,
    sets: [], teamAAtLeft: true, inSetBreak: false, lastFinishedSet: null,
    stats: null, poolName: null, tournamentName: null, scheduledLocal: null,
    pollDelaySeconds: 20,
  }) as unknown as VisBoardData;

const shown = (b: VisBoardData) => b.teamA.players.map((x) => x.jersey);

beforeEach(__resetLineupStability);

describe("within one rally", () => {
  it("keeps the six that is on screen when the feed contradicts itself once", () => {
    const first = six([1, 2, 3, 4, 5, 6]);
    stabiliseLineups(1, board(first, first), 10);
    const wobble = six([2, 3, 4, 5, 6, 1]);
    expect(shown(stabiliseLineups(1, board(wobble, first), 10))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("accepts the change once the feed repeats it", () => {
    const first = six([1, 2, 3, 4, 5, 6]);
    const next = six([2, 3, 4, 5, 6, 1]);
    stabiliseLineups(1, board(first, first), 10);
    stabiliseLineups(1, board(next, first), 10);   // seen once — held
    expect(shown(stabiliseLineups(1, board(next, first), 10))).toEqual([2, 3, 4, 5, 6, 1]);
  });
});

describe("when a rally has been played", () => {
  it("takes the new six at once — the feed is describing something new", () => {
    const first = six([1, 2, 3, 4, 5, 6]);
    stabiliseLineups(1, board(first, first), 10);
    const next = six([2, 3, 4, 5, 6, 1]);
    expect(shown(stabiliseLineups(1, board(next, first), 11))).toEqual([2, 3, 4, 5, 6, 1]);
  });
});

describe("a libero never takes the serve", () => {
  it("refuses a lineup that puts a libero in position 1 of the serving side", () => {
    const ok = six([1, 2, 3, 4, 5, 6], 6);
    stabiliseLineups(1, board(ok, ok), 10);
    // The feed rotates the libero into position 1 while A is serving.
    const bad = six([6, 1, 2, 3, 4, 5], 6);
    expect(shown(stabiliseLineups(1, board(bad, ok, "A"), 11))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("allows it for the side that is NOT serving — there it is legal", () => {
    const ok = six([1, 2, 3, 4, 5, 6], 6);
    stabiliseLineups(1, board(ok, ok), 10);
    const liberoFirst = six([6, 1, 2, 3, 4, 5], 6);
    expect(shown(stabiliseLineups(1, board(liberoFirst, ok, "B"), 11)))
      .toEqual([6, 1, 2, 3, 4, 5]);
  });
});
