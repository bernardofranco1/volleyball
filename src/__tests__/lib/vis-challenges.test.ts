/**
 * Video challenges from the VIS event stream (spec/48 W6).
 *
 * The gate this file exists for: the ten request/result pairs in the two
 * committed captures must come back with the right TEAM, the right TYPE and the
 * right POST-CHALLENGE SCORE. Every one of those three is a thing the overlay
 * puts on air — the requesting team's name in the card header, the reason on its
 * category line, the corrected score on the bug — and until now `replay.ts` was
 * the only code in the repo that read them at all.
 *
 * The captures are full matches, which is what makes them worth this: five
 * challenges each, across three sets, of three different types, with upheld and
 * refused outcomes and one result whose numeric `@Outcome` contradicts its own
 * scoreline.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { num, parseAttrs, tagBlocks } from "@/lib/vis-live/parse";
import {
  parseSetEvents,
  playerSides,
  type ChallengeEvent,
} from "@/lib/vis-live/events";
import { declaredChallengeOf, mapVolleyLive } from "@/lib/vis-live/board-data";

const xmlOf = (match: number) =>
  readFileSync(
    new URL(`../fixtures/vis/volley-live-events-${match}.xml`, import.meta.url),
    "utf-8",
  );

interface SetChallenges {
  setNumber: number;
  /** The set element's own tallies, which are an independent witness. */
  attrs: Record<string, string>;
  challenges: ChallengeEvent[];
}

/** Every set of a capture, with its challenges parsed the way the store does. */
function setsOf(match: number): SetChallenges[] {
  const xml = xmlOf(match);
  const m = parseAttrs(/<Match\b([^>]*)>/.exec(xml)?.[1] ?? "");
  const noTeamA = num(m, "NoTeamA", -1);
  const noTeamB = num(m, "NoTeamB", -2);
  const sides = playerSides(xml, noTeamA, noTeamB);
  return tagBlocks(xml, "Set").map((s) => ({
    setNumber: num(s.attrs, "No"),
    attrs: s.attrs,
    challenges: parseSetEvents(s.inner, { noTeamA, noTeamB, sides }).challenges,
  }));
}

/** One row per challenge, in the shape the assertions are written in. */
function rows(match: number) {
  return setsOf(match).flatMap((s) =>
    s.challenges.map((c) => ({
      set: s.setNumber,
      side: c.side,
      type: c.typeLabel,
      /** The score AFTER the ruling — the explicit point assignment. */
      after: `${c.scoreA}-${c.scoreB}`,
      upheld: c.upheld,
    })),
  );
}

describe("the ten challenges in the reference captures", () => {
  it("reproduces team, type and post-challenge score for 27549", () => {
    // Chinese Taipei (A, 8684) v Iran (B, 8686). Two challenges in set one, one
    // more from B, then one each in set three.
    expect(rows(27549)).toEqual([
      { set: 1, side: "A", type: "BlockTouch", after: "18-18", upheld: true },
      { set: 1, side: "A", type: "BallInOut", after: "18-20", upheld: false },
      { set: 1, side: "B", type: "BallInOut", after: "22-22", upheld: false },
      { set: 3, side: "B", type: "BlockTouch", after: "8-10", upheld: false },
      { set: 3, side: "A", type: "NetTouch", after: "20-17", upheld: true },
    ]);
  });

  it("reproduces team, type and post-challenge score for 27550", () => {
    // Qatar (A, 8682) v Venezuela (B, 8689). Set two has none at all, which is
    // the ordinary case and has to come back as an empty list, not as a gap.
    expect(rows(27550)).toEqual([
      { set: 1, side: "B", type: "BlockTouch", after: "10-15", upheld: true },
      { set: 3, side: "B", type: "BallInOut", after: "3-2", upheld: true },
      { set: 3, side: "A", type: "BlockTouch", after: "10-8", upheld: false },
      { set: 3, side: "A", type: "BlockTouch", after: "14-13", upheld: true },
      { set: 3, side: "A", type: "BallInOut", after: "21-24", upheld: false },
    ]);
    expect(setsOf(27550)[1].challenges).toEqual([]);
  });

  it("finds them wherever the feed put them", () => {
    // All ten are nested INSIDE the rally under review in these captures, which
    // a scan of `<Events>`' direct children alone would miss entirely — the same
    // trap `<Substitution>` sets, and the reason both are read in document order.
    expect(rows(27549)).toHaveLength(5);
    expect(rows(27550)).toHaveLength(5);
    for (const c of [...rows(27549), ...rows(27550)]) {
      expect(c.side).not.toBeNull();
      expect(c.type).not.toBeNull();
    }
  });

  it("agrees with the feed's own accepted/refused tallies, bar the known one", () => {
    // An independent witness: each `<Set>` publishes how many challenges each
    // side requested and how many were refused or accepted. Deriving those from
    // the points rule and comparing is what pins the rule — nothing in the
    // elements themselves says "upheld".
    const disagreements: string[] = [];
    for (const match of [27549, 27550]) {
      for (const s of setsOf(match)) {
        for (const side of ["A", "B"] as const) {
          const own = s.challenges.filter((c) => c.side === side);
          const requested = num(s.attrs, `NbChallengeRequestedTeam${side}`);
          const refused = num(s.attrs, `NbChallengeRefusedTeam${side}`);
          const accepted = num(s.attrs, `NbChallengeAcceptedTeam${side}`);
          expect(own.length, `${match} set ${s.setNumber} ${side} requested`).toBe(
            requested,
          );
          const byPoints = own.filter((c) => c.upheld === false).length;
          if (byPoints !== refused || own.length - byPoints !== accepted) {
            disagreements.push(`${match}/set${s.setNumber}/${side}`);
          }
        }
      }
    }
    // Exactly one, and it is the `Outcome="1"` result whose scoreline moves a
    // point while the set counts the challenge refused (27550 set 3, team A:
    // 13-14 becomes 14-13). The overlay follows the points, because the score it
    // sits next to has visibly changed — see `ChallengeEvent`.
    expect(disagreements).toEqual(["27550/set3/A"]);
  });

  it("records @Outcome and reads nothing from it", () => {
    // The numeric vocabulary is UNVERIFIED (spec/48 §3): "2" and "1" both appear
    // on results that moved a point, and "3" on every one that did not. Anything
    // that switched on this value would call that fourth challenge refused.
    const all = [...setsOf(27549), ...setsOf(27550)].flatMap((s) => s.challenges);
    const byOutcome = new Map<string, boolean[]>();
    for (const c of all) {
      byOutcome.set(c.outcome ?? "", [
        ...(byOutcome.get(c.outcome ?? "") ?? []),
        c.upheld === true,
      ]);
    }
    expect(byOutcome.get("2")).toEqual([true, true, true, true]);
    expect(byOutcome.get("1")).toEqual([true]);
    expect(byOutcome.get("3")).toEqual([false, false, false, false, false]);
  });
});

describe("which challenge is on air, and when", () => {
  const events = (match: number, setNumber: number) =>
    setsOf(match).find((s) => s.setNumber === setNumber)!;

  /** The parsed set stream, in the shape `declaredChallengeOf` takes. */
  const stream = (match: number, setNumber: number) => ({
    rallies: [],
    trailingSubs: [],
    challenges: events(match, setNumber).challenges,
  });

  it("declares the verdict while the score still stands at it", () => {
    // 27549 set three ends on a NetTouch challenge upheld at 20-17. While the
    // score is 20-17 that ruling IS the state of play.
    expect(declaredChallengeOf(stream(27549, 3), 20, 17, 5_000)).toEqual({
      status: "SUCCESSFUL",
      side: "A",
      since: 5_000,
      category: "NetTouch",
    });
  });

  it("declares nothing once a rally has been played since", () => {
    // One point later the challenge is history. A record that stays in the feed
    // for the rest of the set must not keep a card on air with it.
    expect(declaredChallengeOf(stream(27549, 3), 21, 17, 5_000)).toBeNull();
    expect(declaredChallengeOf(stream(27549, 3), 20, 18, 5_000)).toBeNull();
  });

  it("declares a review in progress from a request with no result yet", () => {
    // What a LIVE poll sees during the review: the request is published, the
    // result is not, and the score still stands where the request found it.
    const [first] = events(27549, 1).challenges;
    const pending = {
      rallies: [],
      trailingSubs: [],
      challenges: [{ ...first, scoreA: null, scoreB: null, upheld: null, outcome: null }],
    };
    expect(declaredChallengeOf(pending, 17, 19, 1_000)).toMatchObject({
      status: "REQUESTED",
      side: "A",
      category: "BlockTouch",
    });
    // …and nothing at all if a rally has moved on: that is a request the feed
    // never resolved, not a review happening now.
    expect(declaredChallengeOf(pending, 18, 19, 1_000)).toBeNull();
  });

  it("takes the LAST challenge of the set, not the first", () => {
    // 27550 set three holds four. At 21-24 the one on air is the fourth.
    expect(declaredChallengeOf(stream(27550, 3), 21, 24, 0)).toMatchObject({
      status: "UNSUCCESSFUL",
      side: "A",
      category: "BallInOut",
    });
  });

  it("declares nothing when the set carries no challenge", () => {
    expect(declaredChallengeOf(stream(27550, 2), 16, 25, 0)).toBeNull();
  });

  it("refuses a challenge it cannot attribute to a team", () => {
    // `NoTeam` naming neither side is not a graphic with a missing header; it is
    // a graphic that would name the wrong team.
    const orphan = {
      rallies: [],
      trailingSubs: [],
      challenges: events(27549, 3).challenges.map((c) => ({ ...c, side: null })),
    };
    expect(declaredChallengeOf(orphan, 20, 17, 0)).toBeNull();
  });
});

describe("the board carries the challenge the live path already fetched", () => {
  it("says nothing for a finished match, whose sets are all history", () => {
    // Both captures are complete matches: every set is credited, so every
    // challenge in them is history and no card may be raised from one.
    for (const match of [27549, 27550]) {
      const board = mapVolleyLive(xmlOf(match), match);
      expect(board.status).toBe("FINISHED");
      expect(board.challenge).toBeNull();
    }
  });

  it("declares the challenge when the set in play stands at its score", () => {
    // The live shape, built from the capture: the last set is not yet credited
    // to anybody and stands at 20-17, where 27549's NetTouch challenge was
    // upheld. This is the payload a poll during that beat would carry.
    const xml = xmlOf(27549)
      .replace(/\sEndDateTime="[^"]*"/, "")
      .replace(/(<Match\b[^>]*?)MatchPointsA="3"/, '$1MatchPointsA="2"')
      .replace(
        /(<Set\b[^>]*No="3"[^>]*?)PointsTeamA="25" PointsTeamB="21"/,
        '$1PointsTeamA="20" PointsTeamB="17"',
      );
    // The store hands the already-parsed stream in rather than parsing twice —
    // and that argument is exactly what carries the challenge, so a caller that
    // omits it still gets the pre-spec/48 board.
    const set3 = tagBlocks(xml, "Set").find((s) => num(s.attrs, "No") === 3)!;
    const m = parseAttrs(/<Match\b([^>]*)>/.exec(xml)?.[1] ?? "");
    const noTeamA = num(m, "NoTeamA", -1);
    const noTeamB = num(m, "NoTeamB", -2);
    const parsed = parseSetEvents(set3.inner, {
      noTeamA,
      noTeamB,
      sides: playerSides(xml, noTeamA, noTeamB),
    });
    const board = mapVolleyLive(
      xml,
      27549,
      Date.parse("2026-08-19T12:00:00Z"),
      null,
      null,
      parsed,
    );
    expect(board.status).toBe("LIVE");
    expect(board.currentSet).toBe(3);
    expect([board.scoreA, board.scoreB]).toEqual([20, 17]);
    expect(board.challenge).toMatchObject({
      status: "SUCCESSFUL",
      side: "A",
      category: "NetTouch",
    });
  });
});
