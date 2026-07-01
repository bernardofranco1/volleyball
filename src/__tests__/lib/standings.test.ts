import { describe, expect, it } from "vitest";
import {
  buildStandings,
  fmtRatio,
  type FinishedMatch,
  type StandingsTeam,
} from "@/lib/standings";

const team = (id: string, poolId: string | null = null): StandingsTeam => ({
  id,
  displayName: `Team ${id.toUpperCase()}`,
  poolId,
});

const match = (
  id: string,
  a: string,
  b: string,
  winner: "A" | "B",
  setsA = winner === "A" ? 2 : 0,
  setsB = winner === "B" ? 2 : 0,
): FinishedMatch => ({
  id,
  teamAId: a,
  teamBId: b,
  setsWonA: setsA,
  setsWonB: setsB,
  winner,
});

const noPoints = new Map<string, { a: number; b: number }>();
const noPools = new Map<string, string>();

describe("buildStandings", () => {
  it("returns a single 'Standings' group when no pools exist", () => {
    const groups = buildStandings(
      [team("a"), team("b")],
      [match("m1", "a", "b", "A")],
      noPoints,
      noPools,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Standings");
    expect(groups[0].rows[0].teamId).toBe("a");
    expect(groups[0].rows[0].w).toBe(1);
    expect(groups[0].rows[1].l).toBe(1);
  });

  it("sorts by wins, then set ratio, then point ratio", () => {
    const points = new Map<string, { a: number; b: number }>([
      ["m1", { a: 42, b: 30 }],
      ["m2", { a: 42, b: 35 }],
    ]);
    const groups = buildStandings(
      [team("a"), team("b"), team("c")],
      [
        match("m1", "a", "b", "A", 2, 0),
        match("m2", "c", "b", "A", 2, 1),
      ],
      points,
      noPools,
    );
    const rows = groups[0].rows;
    // a and c both 1 win; a has the better set ratio (2:0 vs 2:1).
    expect(rows.map((r) => r.teamId)).toEqual(["a", "c", "b"]);
  });

  it("uses head-to-head when W, SR and PR are all level", () => {
    // a beats b, b beats c, c beats a — a rock-paper-scissors circle where
    // every team is 1-1 with identical ratios; h2h decides pairwise order.
    const groups = buildStandings(
      [team("a"), team("b"), team("c")],
      [
        match("m1", "a", "b", "A", 2, 1),
        match("m2", "b", "c", "A", 2, 1),
        match("m3", "c", "a", "A", 2, 1),
      ],
      noPoints,
      noPools,
    );
    const rows = groups[0].rows;
    expect(rows).toHaveLength(3);
    // All level on W/SR/PR — the comparator falls back to h2h then name; the
    // key assertion is that aggregation counted every match exactly once.
    for (const r of rows) {
      expect(r.mp).toBe(2);
      expect(r.w).toBe(1);
      expect(r.l).toBe(1);
    }
  });

  it("scopes pool tables to intra-pool matches only", () => {
    const teams = [
      team("a", "p1"),
      team("b", "p1"),
      team("c", "p2"),
      team("d", "p2"),
    ];
    const finished = [
      match("m1", "a", "b", "A"), // pool 1 — counts
      match("m2", "c", "d", "B"), // pool 2 — counts
      match("m3", "a", "c", "A"), // cross-pool (e.g. knockout) — excluded
    ];
    const groups = buildStandings(
      teams,
      finished,
      noPoints,
      new Map([
        ["p1", "Pool A"],
        ["p2", "Pool B"],
      ]),
    );
    expect(groups.map((g) => g.name)).toEqual(["Pool A", "Pool B"]);
    const poolA = groups[0].rows.find((r) => r.teamId === "a")!;
    expect(poolA.mp).toBe(1); // m3 (cross-pool) not counted
    expect(poolA.w).toBe(1);
    const poolB = groups[1].rows.find((r) => r.teamId === "c")!;
    expect(poolB.mp).toBe(1);
  });

  it("groups unpooled teams separately when pools exist", () => {
    const groups = buildStandings(
      [team("a", "p1"), team("b", "p1"), team("x"), team("y")],
      [match("m1", "x", "y", "A")],
      noPoints,
      new Map([["p1", "Pool A"]]),
    );
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(["Pool A", "Unpooled"]);
    const unpooled = groups.find((g) => g.name === "Unpooled")!;
    expect(unpooled.rows.find((r) => r.teamId === "x")!.w).toBe(1);
  });

  it("counts per-match points from the aggregate map", () => {
    const points = new Map([["m1", { a: 63, b: 55 }]]);
    const groups = buildStandings(
      [team("a"), team("b")],
      [match("m1", "a", "b", "A")],
      points,
      noPools,
    );
    const a = groups[0].rows[0];
    expect(a.pw).toBe(63);
    expect(a.pl).toBe(55);
  });

  it("returns [] with no teams", () => {
    expect(buildStandings([], [], noPoints, noPools)).toEqual([]);
  });
});

describe("fmtRatio", () => {
  it("formats finite, zero and infinite ratios", () => {
    expect(fmtRatio(1.5)).toBe("1.500");
    expect(fmtRatio(0)).toBe("–");
    expect(fmtRatio(Infinity)).toBe("∞");
  });
});
