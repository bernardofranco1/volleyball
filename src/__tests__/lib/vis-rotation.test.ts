/**
 * The independent rotation model (spec/42).
 *
 * Every case here is a rule of the game rather than a shape of the feed, which
 * is the point: this model exists to judge the feed, so it must not be derived
 * from it.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalise,
  inferFirstServer,
  ralliesOf,
  rotateOnce,
  rotationsBefore,
  type RallyFacts,
} from "@/lib/vis-live/rotation";

const rallies = (pairs: [number, number][]): RallyFacts[] =>
  pairs.map(([a, b], i) => {
    const pa = i ? pairs[i - 1][0] : 0;
    const pb = i ? pairs[i - 1][1] : 0;
    return { index: i + 1, scoreA: a, scoreB: b, winner: a > pa ? "A" : b > pb ? "B" : null };
  });

describe("rotating", () => {
  it("moves position 2 into position 1 and sends position 1 to the back", () => {
    expect(rotateOnce([1, 2, 3, 4, 5, 6])).toEqual([2, 3, 4, 5, 6, 1]);
  });

  it("leaves an incomplete six alone rather than mangling it", () => {
    expect(rotateOnce([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("counting side-outs", () => {
  it("does not rotate the serving side when it keeps winning", () => {
    // A serves and wins three: nobody rotates.
    const r = rallies([[1, 0], [2, 0], [3, 0]]);
    expect(rotationsBefore(r, "A", 4)).toEqual({ A: 0, B: 0 });
  });

  it("rotates the side that breaks serve, once, and only it", () => {
    // A serves first and wins; B then takes the next: a side-out for B.
    const r = rallies([[1, 0], [1, 1]]);
    expect(rotationsBefore(r, "A", 3)).toEqual({ A: 0, B: 1 });
  });

  it("counts a rotation every time the serve changes hands", () => {
    // A, B, A, B — three side-outs after the first rally.
    const r = rallies([[1, 0], [1, 1], [2, 1], [2, 2]]);
    expect(rotationsBefore(r, "A", 5)).toEqual({ A: 1, B: 2 });
  });

  it("treats the receiving side winning rally one as a side-out", () => {
    // The case the board could not see before: B receives and wins immediately.
    const r = rallies([[0, 1]]);
    expect(rotationsBefore(r, "A", 2)).toEqual({ A: 0, B: 1 });
  });

  it("ignores a rally that moved neither score", () => {
    const r: RallyFacts[] = [{ index: 1, scoreA: 1, scoreB: 0, winner: "A" },
                             { index: 2, scoreA: 1, scoreB: 0, winner: null }];
    expect(rotationsBefore(r, "A", 3)).toEqual({ A: 0, B: 0 });
  });
});

describe("reading the rally stream", () => {
  it("derives each winner from the running score", () => {
    const xml = `<Rally No="1" PointsTeamA="1" PointsTeamB="0"/>
                 <Rally No="2" PointsTeamA="1" PointsTeamB="1"/>
                 <Rally No="3" PointsTeamA="2" PointsTeamB="1"/>`;
    expect(ralliesOf(xml).map((r) => r.winner)).toEqual(["A", "B", "A"]);
  });
});

describe("liberos are not rotation", () => {
  it("collapses either libero to one token so a swap is not a move", () => {
    const lib = new Set(["L1", "L2"]);
    expect(canonicalise(["a", "L1", "c", "d", "e", "f"], lib))
      .toEqual(canonicalise(["a", "L2", "c", "d", "e", "f"], lib));
  });
});

describe("who served first", () => {
  const six = (n: string) => [n + "1", n + "2", n + "3", n + "4", n + "5", n + "6"];
  const starting = { A: six("a"), B: six("b") };
  const none = new Set<string>();

  it("takes an observed first server over any inference", () => {
    const r = rallies([[1, 0], [1, 1], [2, 1]]);
    const pub = { A: [null, null, null], B: [null, null, null] };
    expect(inferFirstServer(r, starting, pub, none, "B")).toEqual({
      firstServer: "B", confidence: "observed",
    });
  });

  it("recovers it from the feed's own lineups when it was not observed", () => {
    // A serves first: A never rotates, B rotates after winning rally 2.
    const r = rallies([[1, 0], [1, 1], [1, 2]]);
    const pub = {
      A: [six("a"), six("a"), six("a")],
      B: [six("b"), six("b"), rotateOnce(six("b"))],
    };
    expect(inferFirstServer(r, starting, pub, none, null)).toEqual({
      firstServer: "A", confidence: "inferred",
    });
  });

  it("says it does not know rather than guessing from too little", () => {
    const r = rallies([[1, 0]]);
    const pub = { A: [six("a")], B: [six("b")] };
    expect(inferFirstServer(r, starting, pub, none, null).confidence).toBe("unknown");
  });
});
