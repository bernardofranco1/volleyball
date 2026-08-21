/**
 * Set point, match point, and which side of the picture a team is on (spec/47).
 *
 * The rule looks obvious and is not: at 24-24 NOBODY is at set point, and the
 * deciding set moves the target from 25 to 15. Both are one-character mistakes
 * that put a wrong graphic on air at the most-watched moment of a match, so both
 * are pinned here.
 */

import { describe, expect, it } from "vitest";
import { handOf, keyMoment, setTarget, sideState } from "@/lib/tv/derive";
import type { VisBoardData } from "@/lib/vis-live/board-data";

/** A LIVE board with the scores and sets a case needs, and nothing else real. */
function board(over: Partial<VisBoardData> = {}): VisBoardData {
  const team = {
    code: "AAA",
    name: "Team",
    players: [],
    timeoutsTaken: 0,
    substitutionsUsed: 0,
    challengesRefused: 0,
    challengesRequested: 0,
    timeoutsRemaining: 2,
    substitutionsRemaining: 6,
    challengesRemaining: 2,
  };
  return {
    matchNo: 1,
    status: "LIVE",
    teamA: { ...team, code: "JPN" },
    teamB: { ...team, code: "POL" },
    setsWonA: 0,
    setsWonB: 0,
    scoreA: 0,
    scoreB: 0,
    currentSet: 1,
    serving: "A",
    sets: [],
    teamAAtLeft: true,
    inSetBreak: false,
    lastFinishedSet: null,
    stats: null,
    poolName: null,
    tournamentName: null,
    scheduledLocal: null,
    pollDelaySeconds: 20,
    recentSubstitutions: [],
    challenge: null,
    ...over,
  };
}

describe("physical sides", () => {
  it("follows the feed, so the bug matches the picture after a side switch", () => {
    expect(handOf(board({ teamAAtLeft: true }))).toEqual({ left: "A", right: "B" });
    expect(handOf(board({ teamAAtLeft: false }))).toEqual({ left: "B", right: "A" });
  });

  it("puts A on the left when the feed does not say, as the U-shape board does", () => {
    // A guess, but the same guess the venue board makes — the two agreeing on
    // one match matters more than either being right before the first whistle.
    expect(handOf(board({ teamAAtLeft: null }))).toEqual({ left: "A", right: "B" });
  });

  it("reads score, sets, serve and time-outs off the right side", () => {
    const b = board({ scoreA: 7, scoreB: 3, setsWonA: 1, setsWonB: 2, serving: "B" });
    b.teamB.timeoutsTaken = 1;
    expect(sideState(b, "A")).toMatchObject({ score: 7, sets: 1, serving: false });
    expect(sideState(b, "B")).toMatchObject({
      score: 3,
      sets: 2,
      serving: true,
      timeoutsTaken: 1,
    });
  });
});

describe("set target", () => {
  it("is 25, and 15 in the deciding set", () => {
    for (const s of [1, 2, 3, 4]) expect(setTarget(board({ currentSet: s }))).toBe(25);
    expect(setTarget(board({ currentSet: 5 }))).toBe(15);
  });
});

describe("key moment", () => {
  it("is silent in the body of a set", () => {
    const b = board({ scoreA: 18, scoreB: 12 });
    expect(keyMoment(b, "A")).toBeNull();
    expect(keyMoment(b, "B")).toBeNull();
  });

  it("calls set point at 24-anything below 24", () => {
    expect(keyMoment(board({ scoreA: 24, scoreB: 20 }), "A")).toBe("SET POINT");
    expect(keyMoment(board({ scoreA: 24, scoreB: 20 }), "B")).toBeNull();
  });

  it("gives NOBODY set point at 24-24, because the next point does not win it", () => {
    const b = board({ scoreA: 24, scoreB: 24 });
    expect(keyMoment(b, "A")).toBeNull();
    expect(keyMoment(b, "B")).toBeNull();
  });

  it("follows the two-point margin past 24", () => {
    // 25-24: one more takes it. 26-25 likewise, and so on up the deuce.
    expect(keyMoment(board({ scoreA: 25, scoreB: 24 }), "A")).toBe("SET POINT");
    expect(keyMoment(board({ scoreA: 25, scoreB: 24 }), "B")).toBeNull();
    expect(keyMoment(board({ scoreA: 31, scoreB: 30 }), "A")).toBe("SET POINT");
  });

  it("uses 15 in the deciding set, so 14-11 is a key moment there and not in set 2", () => {
    // A real fifth set is 2-2, which also makes it match point either way.
    const decider = board({
      currentSet: 5,
      scoreA: 14,
      scoreB: 11,
      setsWonA: 2,
      setsWonB: 2,
    });
    expect(keyMoment(decider, "A")).toBe("MATCH POINT");
    expect(keyMoment(board({ currentSet: 2, scoreA: 14, scoreB: 11 }), "A")).toBeNull();
  });

  it("reads the sets actually won rather than assuming a fifth set is 2-2", () => {
    // Contrived, but it is the feed's figure that decides, not the set number —
    // a forfeited or corrected set can leave the two out of step.
    const odd = board({ currentSet: 5, scoreA: 14, scoreB: 11, setsWonA: 0 });
    expect(keyMoment(odd, "A")).toBe("SET POINT");
  });

  it("says MATCH POINT when the set would be the third", () => {
    expect(
      keyMoment(board({ scoreA: 24, scoreB: 20, setsWonA: 2 }), "A"),
    ).toBe("MATCH POINT");
    expect(
      keyMoment(board({ scoreA: 24, scoreB: 20, setsWonA: 1 }), "A"),
    ).toBe("SET POINT");
  });

  it("goes quiet in a set break, where the score still reads 25-23", () => {
    // The set is over and the next point decides nothing; leaving the strap up
    // through the interval would be wrong twice.
    const b = board({ scoreA: 25, scoreB: 23, inSetBreak: true });
    expect(keyMoment(b, "A")).toBeNull();
  });

  it("goes quiet once the match is finished", () => {
    const b = board({ scoreA: 25, scoreB: 23, setsWonA: 3, status: "FINISHED" });
    expect(keyMoment(b, "A")).toBeNull();
  });

  it("goes quiet before the first whistle, when there is no set", () => {
    expect(keyMoment(board({ status: "UPCOMING", currentSet: null }), "A")).toBeNull();
  });
});
