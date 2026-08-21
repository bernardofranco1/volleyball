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
import type {
  VisBoardData,
  VisBoardPlayer,
  VisChallenge,
} from "@/lib/vis-live/board-data";

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
  /** What the FEED declares, as a mapper fills it in (spec/48 §3). */
  declared?: VisChallenge | null;
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
    challenge: over.declared ?? null,
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

/**
 * A challenge the FEED states, rather than one deduced from counters (spec/48
 * §3). Both feeds carry one: VolleyStation's `challenge_team`/`challenge_reason`
 * and VIS's `<ChallengeRequest>`/`<ChallengeResult>` events. The mapper puts it
 * on the board; everything below is what the machine is still responsible for.
 */
describe("a challenge the feed declares", () => {
  const REQUESTED: VisChallenge = {
    status: "REQUESTED",
    side: "B",
    since: 0,
    category: "netTouch",
  };

  it("goes on air at once, even on the very first frame", () => {
    // Unlike a counter, a declaration is present tense: the feed is saying a
    // challenge is in flight NOW. An instance that starts up mid-review should
    // show it, which is exactly what the counters cannot justify doing.
    const [first] = run([[board({ declared: REQUESTED }), 0]]);
    expect(first.challenge).toMatchObject({
      status: "REQUESTED",
      side: "B",
      category: "netTouch",
      since: 0,
    });
  });

  it("is not re-announced while it stands, and promotes itself to REVIEW", () => {
    const r = run([
      [board({ declared: REQUESTED }), 0],
      [board({ declared: REQUESTED }), 1000],
      [board({ declared: REQUESTED }), 6000],
    ]);
    // `since` never moves: the alert's own clock is what promotes it.
    expect(r[1].challenge).toMatchObject({ status: "REQUESTED", since: 0 });
    expect(r[2].challenge).toMatchObject({ status: "REVIEW", since: 0 });
    expect(r[2].challenge?.category).toBe("netTouch");
  });

  it("takes the verdict from a declaration that changes under it", () => {
    // The VIS shape: the request is published, then the result lands beside it.
    const upheld: VisChallenge = { ...REQUESTED, status: "SUCCESSFUL" };
    const r = run([
      [board({ declared: REQUESTED }), 0],
      [board({ declared: upheld, scoreB: 11 }), 2000],
    ]);
    expect(r[1].challenge).toMatchObject({
      status: "SUCCESSFUL",
      side: "B",
      category: "netTouch",
      since: 2000,
    });
  });

  it("announces a decided challenge ONCE, however long it stays in the payload", () => {
    // VIS keeps a decided challenge in the set's event stream for the rest of
    // the set. Without an identity for the declaration, every poll after it
    // would put the same verdict back on air.
    const upheld: VisChallenge = { ...REQUESTED, status: "SUCCESSFUL" };
    const r = run([
      [board({ declared: REQUESTED }), 0],
      [board({ declared: upheld, scoreB: 11 }), 2000],
      [board({ declared: upheld, scoreB: 11 }), 5000],
      [board({ declared: upheld, scoreB: 11 }), 9000],
      [board({ declared: upheld, scoreB: 11 }), 20_000],
    ]);
    expect(r[2].challenge).toMatchObject({ status: "SUCCESSFUL" });
    // Held for its beat, then gone — and it stays gone.
    expect(r[3].challenge).toBeNull();
    expect(r[4].challenge).toBeNull();
  });

  it("still hears a refusal from the counters, and keeps the label", () => {
    // The VolleyStation shape: the outcome is not in the declaration at all. A
    // refused challenge is one fewer remaining, i.e. one more refused, and the
    // card must not lose its category on the frame it turns red.
    const r = run([
      [board({ declared: REQUESTED }), 0],
      [board({ declared: REQUESTED, refB: 1 }), 3000],
    ]);
    expect(r[1].challenge).toMatchObject({
      status: "UNSUCCESSFUL",
      side: "B",
      category: "netTouch",
    });
  });

  it("reads the score moving under a still-declared request as SUCCESSFUL", () => {
    // An upheld challenge corrects the call. VolleyStation may take a poll to
    // clear `challenge_team`, and the correction must not be swallowed by the
    // declaration outliving it.
    const r = run([
      [board({ declared: REQUESTED, scoreA: 10 }), 0],
      [board({ declared: REQUESTED, scoreA: 11 }), 3000],
    ]);
    expect(r[1].challenge).toMatchObject({ status: "SUCCESSFUL", side: "B" });
  });

  it("keeps the graphic when the declaration simply disappears", () => {
    // `challenge_team` goes null the moment the referees are done, which is
    // before the score or the counters say anything. Dropping the card there
    // would take it off air mid-review.
    const r = run([
      [board({ declared: REQUESTED }), 0],
      [board({}), 1000],
      [board({}), 6000],
    ]);
    expect(r[1].challenge).toMatchObject({ status: "REQUESTED" });
    expect(r[2].challenge).toMatchObject({ status: "REVIEW" });
  });

  it("says nothing for a decided declaration it has never seen requested", () => {
    // A cold instance joining a set whose last challenge was decided ten
    // rallies ago: the declaration is history, and history stays off screen.
    const r = run([
      [board({ declared: { status: "UNSUCCESSFUL", side: "A", since: 0 } }), 0],
      [board({ declared: { status: "UNSUCCESSFUL", side: "A", since: 0 } }), 1000],
    ]);
    expect(r[0].challenge).toBeNull();
    expect(r[1].challenge).toBeNull();
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
