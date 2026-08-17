/**
 * Per-set finals from the replayed snapshot (spec/30 Phase C).
 *
 * The standings' points ratio and the match-centre set pills used to aggregate
 * `MAX(events.scoreAfter*)` over RAW event rows. UNDO and REWIND are resolved
 * by replay, not by deleting rows, so an undone rally still contributes to a
 * MAX. That error was bounded and documented ("one ahead") until F13's fault
 * correction started cancelling several points mid-set — and a wrong points
 * ratio is a wrong RANKING, which is the part that reaches a podium.
 *
 * Two things are pinned: the snapshot parse (where a shape change would bite),
 * and the ranking consequence itself — a case where the stale aggregate and
 * the snapshot put different teams on top.
 */
import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/match-scores";
import { buildStandings } from "@/lib/standings";

const { setsFromSnapshot } = __testing;

describe("setsFromSnapshot", () => {
  it("reads per-set finals in set order, whatever order the array is in", () => {
    const snap = {
      sets: [
        { setNumber: 2, scoreA: 23, scoreB: 25, winner: "B" },
        { setNumber: 1, scoreA: 25, scoreB: 20, winner: "A" },
      ],
    };
    expect(setsFromSnapshot(snap)).toEqual([
      { a: 25, b: 20 },
      { a: 23, b: 25 },
    ]);
  });

  it("drops sets with no winner rather than inventing 0-0 results", () => {
    // A forfeit closes the match without materializing the unplayed sets;
    // printing them as 0-0 would state a result that was never played.
    const snap = {
      sets: [
        { setNumber: 1, scoreA: 25, scoreB: 10, winner: "A" },
        { setNumber: 2, scoreA: 0, scoreB: 0, winner: null },
      ],
    };
    expect(setsFromSnapshot(snap)).toEqual([{ a: 25, b: 10 }]);
  });

  it("refuses anything it cannot trust, so the caller falls back", () => {
    // Every one of these must yield null — the aggregate then answers, which
    // is wrong-ish but never absent. Silently returning [] would erase a
    // match's scores from the standings entirely.
    expect(setsFromSnapshot(null)).toBeNull();
    expect(setsFromSnapshot(undefined)).toBeNull();
    expect(setsFromSnapshot({})).toBeNull();
    expect(setsFromSnapshot({ sets: [] })).toBeNull();
    expect(setsFromSnapshot("not an object")).toBeNull();
    expect(setsFromSnapshot({ sets: [{ setNumber: 1, winner: null }] })).toBeNull();
  });

  it("tolerates missing scores on an otherwise valid set", () => {
    expect(setsFromSnapshot({ sets: [{ setNumber: 1, winner: "A" }] })).toEqual([
      { a: 0, b: 0 },
    ]);
  });
});

describe("the ranking consequence", () => {
  // Two teams, one win each, so the points ratio decides who tops the pool.
  const teams = [
    { id: "t1", displayName: "Team 1", poolId: null, seed: 1 },
    { id: "t2", displayName: "Team 2", poolId: null, seed: 2 },
  ];
  const finished = [
    { id: "m1", teamAId: "t1", teamBId: "t2", setsWonA: 2, setsWonB: 0, winner: "A" as const },
    { id: "m2", teamAId: "t2", teamBId: "t1", setsWonA: 2, setsWonB: 0, winner: "A" as const },
  ];

  const topOf = (points: Map<string, { a: number; b: number }>) =>
    buildStandings(teams, finished, points, new Map())[0].rows[0].teamId;

  it("puts the right team top once cancelled points stop counting", () => {
    // m1: t1 beat t2 50-40. m2: t2 beat t1 50-46.
    // Truth → t1 ratio 96/90, t2 ratio 90/96 ⇒ t1 tops the pool.
    const truth = new Map([
      ["m1", { a: 50, b: 40 }],
      ["m2", { a: 50, b: 46 }],
    ]);
    expect(topOf(truth)).toBe("t1");
  });

  it("would have put the WRONG team top while the stale aggregate was used", () => {
    // Same matches, but m1 had a fault correction cancelling 8 of t2's points
    // that the MAX aggregate still counted: it reported t2 with 48, not 40.
    // t1 ratio 96/98, t2 ratio 98/96 ⇒ t2 tops the pool. Same fixtures, same
    // code, different winner — which is exactly why this moved off the MAX.
    const stale = new Map([
      ["m1", { a: 50, b: 48 }],
      ["m2", { a: 50, b: 46 }],
    ]);
    expect(topOf(stale)).toBe("t2");
  });
});
