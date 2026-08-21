/**
 * The two TV signals that need two polls to see (spec/47): a challenge in
 * flight, and — on VolleyStation — a substitution.
 *
 * Driven as a sequence of frames, which is the only way to test a state machine
 * whose whole job is noticing change. The cases that matter are the ones where
 * it must stay SILENT: a cold start mid-challenge, a set rolling over and
 * resetting the counters, and a libero going on and off.
 */

import { describe, expect, it } from "vitest";
import { tvSignals, type TvSignalState } from "@/lib/vis-live/tv-signals";
import type { VisBoardData, VisBoardPlayer } from "@/lib/vis-live/board-data";

function six(numbers: number[], liberoAt: number[] = []): VisBoardPlayer[] {
  return numbers.map((jersey, i) => ({
    position: i + 1,
    jersey,
    name: `P${jersey}`,
    points: 0,
    isLibero: liberoAt.includes(i),
  }));
}

function board(over: {
  set?: number;
  scoreA?: number;
  scoreB?: number;
  reqA?: number;
  reqB?: number;
  refA?: number;
  refB?: number;
  sixA?: VisBoardPlayer[];
  sixB?: VisBoardPlayer[];
} = {}): VisBoardData {
  const team = (
    players: VisBoardPlayer[],
    requested: number,
    refused: number,
  ) => ({
    code: "AAA",
    name: "Team",
    players,
    timeoutsTaken: 0,
    substitutionsUsed: 0,
    challengesRefused: refused,
    challengesRequested: requested,
    timeoutsRemaining: 2,
    substitutionsRemaining: 6,
    challengesRemaining: 2,
  });
  return {
    matchNo: 1,
    status: "LIVE",
    teamA: team(over.sixA ?? six([1, 2, 3, 4, 5, 6]), over.reqA ?? 0, over.refA ?? 0),
    teamB: team(over.sixB ?? six([7, 8, 9, 10, 11, 12]), over.reqB ?? 0, over.refB ?? 0),
    setsWonA: 0,
    setsWonB: 0,
    scoreA: over.scoreA ?? 10,
    scoreB: over.scoreB ?? 10,
    currentSet: over.set ?? 1,
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
  };
}

const OPTS = { synthesiseSubs: false };

/** Run a list of [board, now] frames through, returning every step's output. */
function run(
  frames: [VisBoardData, number][],
  opts = OPTS,
): { state: TvSignalState; challenge: VisBoardData["challenge"] }[] {
  let state: TvSignalState | null = null;
  const out = [];
  for (const [b, now] of frames) {
    const r = tvSignals(state, b, now, opts);
    state = r.state;
    out.push({ state: r.state, challenge: r.challenge });
  }
  return out;
}

describe("challenge state machine", () => {
  it("says nothing on the first frame it ever sees", () => {
    // A cold instance can join a match mid-challenge, and the counters alone
    // cannot tell it whether the challenge is happening now or happened at 6-4.
    const [first] = run([[board({ reqA: 1, refA: 1 }), 0]]);
    expect(first.challenge).toBeNull();
  });

  it("raises REQUESTED when a request counter moves", () => {
    const r = run([
      [board(), 0],
      [board({ reqA: 1 }), 1000],
    ]);
    expect(r[1].challenge).toMatchObject({ status: "REQUESTED", side: "A" });
  });

  it("moves on to REVIEW after the alert has stood a few seconds", () => {
    const r = run([
      [board(), 0],
      [board({ reqA: 1 }), 1000],
      [board({ reqA: 1 }), 3000],
      [board({ reqA: 1 }), 6000],
    ]);
    expect(r[2].challenge).toMatchObject({ status: "REQUESTED" });
    expect(r[3].challenge).toMatchObject({ status: "REVIEW" });
    // The clock runs from the request, not from the frame that promoted it.
    expect(r[3].challenge?.since).toBe(1000);
  });

  it("reads a refusal as UNSUCCESSFUL", () => {
    const r = run([
      [board(), 0],
      [board({ reqB: 1 }), 1000],
      [board({ reqB: 1, refB: 1 }), 3000],
    ]);
    expect(r[2].challenge).toMatchObject({ status: "UNSUCCESSFUL", side: "B" });
  });

  it("reads a refusal even when the request was never seen", () => {
    const r = run([
      [board(), 0],
      [board({ refA: 1 }), 1000],
    ]);
    expect(r[1].challenge).toMatchObject({ status: "UNSUCCESSFUL", side: "A" });
  });

  it("reads a score change with no refusal as SUCCESSFUL", () => {
    // A team that wins its challenge keeps the right to another, so the refused
    // counter does NOT move and nothing in the feed says "upheld". The score
    // moving is the only signal there is.
    const r = run([
      [board({ scoreA: 10 }), 0],
      [board({ scoreA: 10, reqA: 1 }), 1000],
      [board({ scoreA: 11, reqA: 1 }), 3000],
    ]);
    expect(r[2].challenge).toMatchObject({ status: "SUCCESSFUL", side: "A" });
  });

  it("holds a decided result for a beat, then clears it", () => {
    const r = run([
      [board(), 0],
      [board({ reqA: 1, refA: 1 }), 1000],
      [board({ reqA: 1, refA: 1 }), 4000],
      [board({ reqA: 1, refA: 1 }), 9000],
    ]);
    expect(r[2].challenge).toMatchObject({ status: "UNSUCCESSFUL" });
    expect(r[3].challenge).toBeNull();
  });

  it("stays silent when a new set resets the per-set counters to zero", () => {
    // Going 2 → 0 is not two challenges being returned; it is a new set.
    const r = run([
      [board({ set: 1, reqA: 2, refA: 1 }), 0],
      [board({ set: 1, reqA: 2, refA: 1 }), 1000],
      [board({ set: 2, reqA: 0, refA: 0 }), 2000],
      [board({ set: 2, reqA: 0, refA: 0 }), 3000],
    ]);
    expect(r[2].challenge).toBeNull();
    expect(r[3].challenge).toBeNull();
  });
});

describe("substitutions inferred from the six (VolleyStation)", () => {
  const SUBS = { synthesiseSubs: true };

  it("reports a clean one-for-one change", () => {
    const before = six([1, 2, 3, 4, 5, 6]);
    const after = six([1, 2, 3, 4, 5, 14]);
    let state = tvSignals(null, board({ sixA: before }), 0, SUBS).state;
    const r = tvSignals(state, board({ sixA: after }), 1000, SUBS);
    expect(r.substitutions).toHaveLength(1);
    expect(r.substitutions[0]).toMatchObject({
      side: "A",
      outJersey: 6,
      inJersey: 14,
    });
    state = r.state;
    // And does not re-report it on the next identical frame.
    expect(
      tvSignals(state, board({ sixA: after }), 2000, SUBS).substitutions,
    ).toHaveLength(1);
  });

  it("ignores a libero coming ON", () => {
    const before = six([1, 2, 3, 4, 5, 6]);
    const after = six([1, 2, 3, 4, 5, 20], [5]); // 20 is the libero
    const state = tvSignals(null, board({ sixA: before }), 0, SUBS).state;
    expect(
      tvSignals(state, board({ sixA: after }), 1000, SUBS).substitutions,
    ).toHaveLength(0);
  });

  it("ignores a libero going OFF, which needs the previous frame's flags", () => {
    const before = six([1, 2, 3, 4, 5, 20], [5]);
    const after = six([1, 2, 3, 4, 5, 6]);
    const state = tvSignals(null, board({ sixA: before }), 0, SUBS).state;
    expect(
      tvSignals(state, board({ sixA: after }), 1000, SUBS).substitutions,
    ).toHaveLength(0);
  });

  it("refuses to guess when two players change at once", () => {
    // The poll straddled two events, or the feed rewrote the rotation. Pairing
    // them up would be a coin toss, and a lower third naming the wrong two
    // players is worse than no lower third.
    const before = six([1, 2, 3, 4, 5, 6]);
    const after = six([1, 2, 3, 4, 15, 16]);
    const state = tvSignals(null, board({ sixA: before }), 0, SUBS).state;
    expect(
      tvSignals(state, board({ sixA: after }), 1000, SUBS).substitutions,
    ).toHaveLength(0);
  });

  it("leaves the feed's own events alone when the source publishes them", () => {
    // On VIS the mapper reports real substitutions, with the score they
    // happened at, which an inference cannot recover.
    const b = board();
    b.recentSubstitutions = [
      {
        side: "A",
        outJersey: 4,
        outName: "OUT",
        inJersey: 9,
        inName: "IN",
        setNumber: 1,
        scoreA: 8,
        scoreB: 6,
      },
    ];
    const state = tvSignals(null, board(), 0, OPTS).state;
    const r = tvSignals(state, b, 1000, OPTS);
    expect(r.substitutions).toEqual(b.recentSubstitutions);
  });
});
