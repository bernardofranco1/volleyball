/**
 * Serve succession (spec/43) — the rule the boards now obey.
 *
 * The fixtures are REAL VIS payloads (`GetVolleyLive Options="65535"`, captured
 * read-only on 2026-08-20 by scripts/capture-vis-events.mts) for four finished
 * matches. Two edits are declared in that script: the statistics rows are
 * reduced to a per-player remnant, and the `Identifier` UUIDs are dropped.
 * Everything these tests read — the serve actions, the lineups, the
 * substitutions, the scores, the rosters — is verbatim.
 *
 * 27550 is the match that matters: its feed never applied nine rotations, it
 * contains an on-court wrong-server fault, and it seats a libero at position 1
 * of the RECEIVING side. Anything that can go wrong with a rotation has already
 * gone wrong in it once.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  designatedLiberos,
  parseSetEvents,
  playerSides,
  type SetEvents,
} from "@/lib/vis-live/events";
import { enforceLineups } from "@/lib/vis-live/serve-succession";
import { sixOf, type Side, type Six } from "@/lib/vis-live/rotation";
import { allTagAttrs, num, tagBlocks } from "@/lib/vis-live/parse";

const MATCHES = [27550, 27547, 27549, 26959] as const;

const fixture = (matchNo: number) =>
  readFileSync(
    new URL(`../fixtures/vis/volley-live-events-${matchNo}.xml`, import.meta.url),
    "utf-8",
  );

interface LoadedSet {
  setNo: number;
  events: SetEvents;
  startingLineups: { A: Six | null; B: Six | null };
  /** Per set, exactly as the store computes it — never match-wide. */
  liberos: Set<string>;
}

interface Loaded {
  matchNo: number;
  sets: LoadedSet[];
  sides: Map<string, Side>;
}

function load(matchNo: number): Loaded {
  const xml = fixture(matchNo);
  const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
  const noTeamA = num(match, "NoTeamA", -1);
  const noTeamB = num(match, "NoTeamB", -2);
  const sides = playerSides(xml, noTeamA, noTeamB);
  const sets = tagBlocks(xml, "Set")
    .sort((a, b) => num(a.attrs, "No") - num(b.attrs, "No"))
    .map((s) => {
      const head = s.inner.split("<Events")[0];
      const startingFor = (noTeam: number) => {
        const row = allTagAttrs(head, "LineUp").find(
          (l) => num(l, "NoTeam", -99) === noTeam,
        );
        return row ? sixOf(row) : null;
      };
      return {
        setNo: num(s.attrs, "No", 0),
        events: parseSetEvents(s.inner, { noTeamA, noTeamB, sides }),
        startingLineups: { A: startingFor(noTeamA), B: startingFor(noTeamB) },
        liberos: designatedLiberos(s.inner),
      };
    });
  return { matchNo, sets, sides };
}

const LOADED = MATCHES.map(load);

/** The set stream truncated to the rallies BEFORE `upTo` (1-based, exclusive). */
function truncate(set: LoadedSet, upTo: number): SetEvents {
  return {
    rallies: set.events.rallies.slice(0, upTo - 1),
    // Trailing substitutions of the truncated stream are the ones recorded in
    // the gap before the rally now in progress.
    trailingSubs: set.events.rallies[upTo - 1]?.subsBefore ?? [],
  };
}

/**
 * The one rally in 540 that no model can predict: 27550 set 1 rally 15. Player
 * 232492 had won the previous rally while serving, so R1 says he serves again;
 * the feed's own lineup agrees. 232496 served instead, the fault was called and
 * Qatar took the point (5-9 → 6-9). See spec/43 §3.
 */
const ON_COURT_ANOMALY = { matchNo: 27550, setNo: 1, rallyNo: 15 };

describe("the rule, over every rally of four real matches", () => {
  it("predicts the player who actually served, with one enumerated exception", () => {
    const misses: string[] = [];
    let predicted = 0;

    for (const match of LOADED) {
      for (const set of match.sets) {
        for (const rally of set.events.rallies) {
          if (!rally.server) continue;
          const side = match.sides.get(rally.server);
          if (!side) continue;

          // Everything the board would know one moment before this serve.
          const enforced = enforceLineups({
            events: truncate(set, rally.index),
            startingLineups: set.startingLineups,
            liberos: set.liberos,
            sides: match.sides,
            remembered: null,
          });
          const six = enforced[side];
          if (!six) continue;

          if (six[0] === rally.server) {
            predicted++;
          } else {
            misses.push(
              `${match.matchNo} set ${set.setNo} rally ${rally.index}: ` +
                `served ${rally.server}, model said ${six[0]}`,
            );
          }
        }
      }
    }

    const expectedMiss =
      `${ON_COURT_ANOMALY.matchNo} set ${ON_COURT_ANOMALY.setNo} ` +
      `rally ${ON_COURT_ANOMALY.rallyNo}: served 232496, model said 232492`;
    expect(misses).toEqual([expectedMiss]);
    expect(predicted).toBe(539);
  });

  it("agrees with the settled feed on every rally of every set — it is not a second opinion", () => {
    // This is the safety property that makes enforcement fit to put on an arena
    // screen. Against the SETTLED record of four complete matches — 540 rallies,
    // both sides, every rally — the enforced six is identical to the six VIS
    // published, position for position. Enforcement is not a different answer;
    // it is the same answer derived from the rules and the serve actions, which
    // is why it can be trusted a rally earlier and through the feed's rewrite
    // window, where the published lineup is not yet the settled one.
    //
    // It also corrects spec/42 (see the correction note in that document): the
    // nine divergences logged live against 27550 do NOT appear here, because
    // they were never the feed's fault.
    const divergences: string[] = [];
    let compared = 0;
    for (const match of LOADED) {
      for (const set of match.sets) {
        for (const rally of set.events.rallies) {
          const enforced = enforceLineups({
            events: truncate(set, rally.index),
            startingLineups: set.startingLineups,
            liberos: set.liberos,
            sides: match.sides,
            remembered: null,
          });
          for (const side of ["A", "B"] as const) {
            const six = enforced[side];
            const feed = rally.lineup[side];
            if (!six || !feed) continue;
            compared++;
            if (six.join() !== feed.join()) {
              divergences.push(
                `${match.matchNo} set ${set.setNo} rally ${rally.index} ${side}: ` +
                  `model ${six.join(",")} vs feed ${feed.join(",")}`,
              );
            }
          }
        }
      }
    }
    expect(divergences).toEqual([]);
    expect(compared).toBe(1080);
  });
});

describe("R1 — the serving team keeps the serve", () => {
  const match = LOADED.find((m) => m.matchNo === 27547)!;

  it("leaves the same player serving, and rotates nobody", () => {
    const set = match.sets[0];
    // Find a serve-win with no substitution in the gap that follows.
    const at = set.events.rallies.findIndex((r, i) => {
      const next = set.events.rallies[i + 1];
      if (!r.server || !next?.server || next.subsBefore.length > 0) return false;
      return match.sides.get(r.server) === r.winner;
    });
    expect(at).toBeGreaterThanOrEqual(0);

    const before = enforceLineups({
      events: truncate(set, at + 1),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });
    const after = enforceLineups({
      events: truncate(set, at + 2),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });
    expect(after.A).toEqual(before.A);
    expect(after.B).toEqual(before.B);
    expect(set.events.rallies[at + 1].server).toBe(set.events.rallies[at].server);
  });

  it("gives the serve to the incoming player when the server is substituted", () => {
    // A substitution replaces a player in place, so if it takes the server off
    // the court the player who came on inherits the serve.
    const six = ["10", "2", "3", "4", "5", "6"];
    const events: SetEvents = {
      rallies: [
        {
          index: 1,
          scoreA: 1,
          scoreB: 0,
          winner: "A",
          server: "10",
          lineup: { A: six, B: null },
          subsBefore: [],
        },
      ],
      trailingSubs: [{ out: "10", in: "11", side: "A" }],
    };
    const enforced = enforceLineups({
      events,
      startingLineups: { A: six, B: ["20", "21", "22", "23", "24", "25"] },
      liberos: new Set(),
      sides: new Map([["10", "A"], ["11", "A"]]),
      remembered: "A",
    });
    expect(enforced.A).toEqual(["11", "2", "3", "4", "5", "6"]);
  });
});

describe("R2 — a side-out rotates the winner", () => {
  it("gives the serve to the player who stood at position 2", () => {
    const a = ["1", "2", "3", "4", "5", "6"];
    const b = ["20", "21", "22", "23", "24", "25"];
    const events: SetEvents = {
      rallies: [
        {
          index: 1,
          scoreA: 0,
          scoreB: 1,
          winner: "B",
          server: "1",
          lineup: { A: a, B: b },
          subsBefore: [],
        },
      ],
      trailingSubs: [],
    };
    const enforced = enforceLineups({
      events,
      startingLineups: { A: a, B: b },
      liberos: new Set(),
      sides: new Map([
        ["1", "A"],
        ["21", "B"],
      ]),
      remembered: "A",
    });
    // B received and won: B rotates, and B's previous position 2 now serves.
    expect(enforced.B?.[0]).toBe("21");
    expect(enforced.B).toEqual(["21", "22", "23", "24", "25", "20"]);
    // A did not rotate.
    expect(enforced.A).toEqual(a);
  });

  it("holds on every side-out of every set of every match", () => {
    // The rule stated directly against the feed's own record, with no model in
    // the way: after a side-out with no substitution, the player who served is
    // the one the feed itself had standing at position 2.
    let sideOuts = 0;
    for (const match of LOADED) {
      for (const set of match.sets) {
        for (const rally of set.events.rallies) {
          if (!rally.server) continue;
          const prev = set.events.rallies[rally.index - 2];
          if (!prev?.winner || !prev.server) continue;
          if (prev.winner === match.sides.get(prev.server)) continue; // no side-out
          const prevSix = prev.lineup[prev.winner];
          if (!prevSix) continue;
          sideOuts++;
          // ...unless a substitution replaced them in the gap, in which case
          // the incoming player inherits the position and the serve.
          const swapped = rally.subsBefore.find((s) => s.out === prevSix[1]);
          const expected = swapped ? swapped.in : prevSix[1];
          expect(`${match.matchNo}/${rally.index}: ${rally.server}`).toBe(
            `${match.matchNo}/${rally.index}: ${expected}`,
          );
        }
      }
    }
    expect(sideOuts).toBeGreaterThan(250);
  });
});

describe("R3 — the libero", () => {
  it("leaves a libero standing at position 1 of the RECEIVING side alone", () => {
    // 27550 set 1 rally 13: libero 232497 is at position 1 for Venezuela while
    // Qatar serves. Legal, and really happens — 0-2.2% of rallies (spec/42).
    const match = LOADED.find((m) => m.matchNo === 27550)!;
    const set = match.sets[0];
    const rally = set.events.rallies[12];
    expect(rally.lineup.B?.[0]).toBe("232497");
    expect(set.liberos.has("232497")).toBe(true);

    const enforced = enforceLineups({
      events: truncate(set, 13),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });
    // The serving side is Qatar; Venezuela's six is untouched and unrefused.
    expect(enforced.B).not.toBeNull();
    expect(enforced.notes.filter((n) => n.kind === "libero-serving-refused")).toEqual([]);
  });

  it("never seats a libero in the serving position", () => {
    let liberoOnServe = 0;
    for (const match of LOADED) {
      for (const set of match.sets) {
        for (const rally of set.events.rallies) {
          if (!rally.server) continue;
          const side = match.sides.get(rally.server);
          if (!side) continue;
          const enforced = enforceLineups({
            events: truncate(set, rally.index),
            startingLineups: set.startingLineups,
            liberos: set.liberos,
            sides: match.sides,
            remembered: null,
          });
          const six = enforced[side];
          if (six && set.liberos.has(six[0])) liberoOnServe++;
        }
      }
    }
    expect(liberoOnServe).toBe(0);
  });

  it("treats a libero exchange as an ordinary substitution — nobody moves", () => {
    const six = ["1", "2", "3", "4", "5", "6"];
    const events: SetEvents = {
      rallies: [
        {
          index: 1,
          scoreA: 1,
          scoreB: 0,
          winner: "A",
          server: "1",
          lineup: { A: six, B: null },
          subsBefore: [],
        },
      ],
      // The libero comes on for the player at position 5.
      trailingSubs: [{ out: "5", in: "99", side: "A" }],
    };
    const enforced = enforceLineups({
      events,
      startingLineups: { A: six, B: ["20", "21", "22", "23", "24", "25"] },
      liberos: new Set(["99"]),
      sides: new Map([["1", "A"], ["5", "A"], ["99", "A"]]),
      remembered: "A",
    });
    expect(enforced.A).toEqual(["1", "2", "3", "4", "99", "6"]);
    expect(enforced.notes).toEqual([]);
  });
});

describe("the on-court wrong-server anomaly", () => {
  const match = LOADED.find((m) => m.matchNo === 27550)!;
  const set = match.sets[0];

  const upTo = (n: number) =>
    enforceLineups({
      events: truncate(set, n),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });

  it("records it, and refuses to follow it", () => {
    // Through rally 15 the anomaly is now a recorded fact rather than a
    // prediction, and the model must NOT re-anchor: the feed's own lineup
    // agrees with the model, so the serve is the outlier.
    const enforced = upTo(16);
    const anomalies = enforced.notes.filter((n) => n.kind === "serve-anomaly");
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      rallyNo: 15,
      side: "B",
      observedServer: "232496",
      predictedServer: "232492",
    });
    expect(enforced.notes.filter((n) => n.kind.startsWith("reanchor"))).toEqual([]);
  });

  it("still predicts that team's next serve two rallies later", () => {
    // This is the regression test for the arbitration policy. Following the
    // anomalous serve rotates Venezuela two places, and rally 17 — their next —
    // then comes out as 232498 instead of 232500.
    expect(set.events.rallies[16].server).toBe("232500");
    expect(upTo(17).B?.[0]).toBe("232500");
  });
});

describe("first server resolution", () => {
  const match = LOADED.find((m) => m.matchNo === 26959)!;
  const set = match.sets[0];

  it("takes the opening rally's serve action on a cold instance", () => {
    const enforced = enforceLineups({
      events: truncate(set, 6),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });
    expect(enforced.confidence).toBe("action");
    expect(enforced.firstServer).toBe(match.sides.get(set.events.rallies[0].server!));
  });

  it("prefers what the store observed before the set had any rallies", () => {
    const observed = enforceLineups({
      events: truncate(set, 6),
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: match.sides.get(set.events.rallies[0].server!)!,
    });
    expect(observed.confidence).toBe("observed");
  });

  it("shows the starting six, enforced, before a rally has been played", () => {
    const enforced = enforceLineups({
      events: { rallies: [], trailingSubs: [] },
      startingLineups: set.startingLineups,
      liberos: set.liberos,
      sides: match.sides,
      remembered: null,
    });
    expect(enforced.basis).toBe("enforced");
    expect(enforced.A).toEqual(set.startingLineups.A);
    expect(enforced.B).toEqual(set.startingLineups.B);
  });
});

describe("degrading rather than guessing", () => {
  it("falls back when the set has no starting lineup to build on", () => {
    const enforced = enforceLineups({
      events: { rallies: [], trailingSubs: [] },
      startingLineups: { A: null, B: null },
      liberos: new Set(),
      sides: new Map(),
      remembered: null,
    });
    expect(enforced.basis).toBe("fallback");
    expect(enforced.A).toBeNull();
    expect(enforced.B).toBeNull();
  });

  it("falls back when nothing can name the set's first server", () => {
    const six = ["1", "2", "3", "4", "5", "6"];
    const enforced = enforceLineups({
      events: {
        rallies: [
          {
            index: 1,
            scoreA: 1,
            scoreB: 0,
            winner: "A",
            server: null, // a payload without Options bit 1
            lineup: { A: null, B: null },
            subsBefore: [],
          },
        ],
        trailingSubs: [],
      },
      startingLineups: { A: six, B: ["20", "21", "22", "23", "24", "25"] },
      liberos: new Set(),
      sides: new Map(),
      remembered: null,
    });
    expect(enforced.basis).toBe("fallback");
  });

  it("is pure — a corrected score changes the answer and leaves no residue", () => {
    const a = ["1", "2", "3", "4", "5", "6"];
    const b = ["20", "21", "22", "23", "24", "25"];
    const sides = new Map<string, Side>([["1", "A"], ["20", "B"]]);
    const rally = (winner: Side) => ({
      index: 1,
      scoreA: winner === "A" ? 1 : 0,
      scoreB: winner === "B" ? 1 : 0,
      winner,
      server: "1",
      lineup: { A: null, B: null },
      subsBefore: [],
    });
    const run = (winner: Side) =>
      enforceLineups({
        events: { rallies: [rally(winner)], trailingSubs: [] },
        startingLineups: { A: a, B: b },
        liberos: new Set(),
        sides,
        remembered: "A",
      });
    // A served and won: nobody rotates. Overturn it and B rotates.
    expect(run("A").B).toEqual(b);
    expect(run("B").B).toEqual(["21", "22", "23", "24", "25", "20"]);
    // And back again: no state survives between calls.
    expect(run("A").B).toEqual(b);
  });
});
