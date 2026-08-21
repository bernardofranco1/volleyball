/**
 * What is on screen, and for how long (spec/47).
 *
 * The director is where a broadcast overlay gets embarrassing: a graphic that
 * fires five times, a backlog that plays out over a live rally, two lower thirds
 * on the same side at once, a card that never comes down. Each of those is a case
 * below.
 */

import { describe, expect, it } from "vitest";
import {
  NO_OPERATOR,
  NOTHING,
  demoBoard,
  demoGraphics,
  direct,
  parseDemo,
  seedDirector,
  subKey,
  type OperatorState,
} from "@/lib/tv/director";
import type { VisBoardData, VisSubstitution } from "@/lib/vis-live/board-data";

function sub(over: Partial<VisSubstitution> = {}): VisSubstitution {
  return {
    side: "A",
    outJersey: 4,
    outName: "OUT",
    inJersey: 9,
    inName: "IN",
    setNumber: 1,
    scoreA: 8,
    scoreB: 6,
    ...over,
  };
}

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
    teamA: { ...team, code: "JPN", name: "Japan" },
    teamB: { ...team, code: "POL", name: "Poland" },
    setsWonA: 0,
    setsWonB: 0,
    scoreA: 10,
    scoreB: 10,
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

const op = (over: Partial<OperatorState> = {}): OperatorState => ({
  ...NO_OPERATOR,
  ...over,
});

describe("the bug", () => {
  it("is up by default", () => {
    const b = board();
    expect(direct(seedDirector(b), b, op(), 0).graphics.bug).toBe(true);
  });

  it("goes down under a full challenge card, and stays up under the alert tab", () => {
    const alert = board({ challenge: { status: "REQUESTED", side: "A", since: 0 } });
    expect(direct(seedDirector(alert), alert, op(), 0).graphics.bug).toBe(true);
    const card = board({ challenge: { status: "REVIEW", side: "A", since: 0 } });
    expect(direct(seedDirector(card), card, op(), 0).graphics.bug).toBe(false);
  });

  it("takes everything off for the hide-all key, and keeps running underneath", () => {
    const b = board({ recentSubstitutions: [sub()] });
    const seeded = seedDirector(board());
    const r = direct(seeded, b, op({ hideAll: true }), 1000);
    expect(r.graphics).toMatchObject({ bug: false, substitution: null });
    // The substitution was still consumed, so it does not fire on the way back.
    expect(r.memory.announced).toContain(subKey(sub()));
  });
});

describe("substitutions", () => {
  it("never plays out the backlog that was already there on load", () => {
    // A page opened at 18-14 in the third set has a list of substitutions that
    // all already happened.
    const b = board({
      recentSubstitutions: [sub(), sub({ inJersey: 10 }), sub({ inJersey: 11 })],
    });
    const seeded = seedDirector(b);
    expect(direct(seeded, b, op(), 0).graphics.substitution).toBeNull();
  });

  it("announces a new one, once", () => {
    const before = board();
    const after = board({ recentSubstitutions: [sub()] });
    const first = direct(seedDirector(before), after, op(), 1000);
    expect(first.graphics.substitution).toMatchObject({ hand: "left" });
    // It stays up while its window runs, and it is the SAME one.
    const during = direct(first.memory, after, op(), 4000);
    expect(during.graphics.substitution?.sub.inJersey).toBe(9);
    // And it comes down after the hold.
    const later = direct(during.memory, after, op(), 12_000);
    expect(later.graphics.substitution).toBeNull();
  });

  it("shows two substitutions in sequence rather than at once", () => {
    const before = board();
    const two = board({
      recentSubstitutions: [sub(), sub({ inJersey: 10, scoreA: 9 })],
    });
    const a = direct(seedDirector(before), two, op(), 1000);
    expect(a.graphics.substitution?.sub.inJersey).toBe(9);
    // Still the first one three seconds in — not both, not the second.
    const b = direct(a.memory, two, op(), 4000);
    expect(b.graphics.substitution?.sub.inJersey).toBe(9);
    // The second only once the first's window is spent.
    const c = direct(b.memory, two, op(), 12_000);
    expect(c.graphics.substitution?.sub.inJersey).toBe(10);
  });

  it("puts the graphic on the side of the picture the team is standing on", () => {
    const before = board({ teamAAtLeft: false });
    const after = board({ teamAAtLeft: false, recentSubstitutions: [sub({ side: "A" })] });
    expect(direct(seedDirector(before), after, op(), 1000).graphics.substitution).toMatchObject(
      { hand: "right" },
    );
  });
});

describe("time-out", () => {
  it("appears when a team's count moves, and comes down when play resumes", () => {
    const before = board();
    const called = board();
    called.teamB.timeoutsTaken = 1;
    const r = direct(seedDirector(before), called, op(), 1000);
    expect(r.graphics.timeout).toMatchObject({ hand: "right" });
    // A point being played is the end of the time-out, whatever the clock says.
    const resumed = board({ scoreA: 11 });
    resumed.teamB.timeoutsTaken = 1;
    expect(direct(r.memory, resumed, op(), 3000).graphics.timeout).toBeNull();
  });

  it("expires on its own if no point follows", () => {
    const before = board();
    const called = board();
    called.teamB.timeoutsTaken = 1;
    const r = direct(seedDirector(before), called, op(), 1000);
    expect(direct(r.memory, called, op(), 40_000).graphics.timeout).toBeNull();
  });

  it("does not read a new set's counter reset as a time-out", () => {
    const first = board({ currentSet: 1 });
    first.teamA.timeoutsTaken = 2;
    const seeded = direct(seedDirector(first), first, op(), 0);
    const next = board({ currentSet: 2 });
    expect(direct(seeded.memory, next, op(), 1000).graphics.timeout).toBeNull();
  });

  it("yields to a substitution on the same side", () => {
    // The substitution names players; the time-out only names a team, and its
    // window is far longer.
    const before = board();
    const both = board({ recentSubstitutions: [sub({ side: "A" })] });
    both.teamA.timeoutsTaken = 1;
    const r = direct(seedDirector(before), both, op(), 1000);
    expect(r.graphics.substitution).not.toBeNull();
    expect(r.graphics.timeout).toBeNull();
  });
});

describe("challenge", () => {
  it("carries the requesting team's name for the header", () => {
    const b = board({ challenge: { status: "REVIEW", side: "B", since: 0 } });
    expect(direct(seedDirector(b), b, op(), 0).graphics.challenge).toMatchObject({
      hand: "right",
      teamName: "Poland",
    });
  });

  it("takes the operator's category, since no feed carries one", () => {
    const b = board({ challenge: { status: "REVIEW", side: "A", since: 0 } });
    const r = direct(seedDirector(b), b, op({ category: "NET TOUCH" }), 0);
    expect(r.graphics.challenge?.category).toBe("NET TOUCH");
  });

  it("lets the operator drive it outright when the feed says nothing", () => {
    // The expected case on a VolleyStation-sourced match.
    const b = board();
    const r = direct(
      seedDirector(b),
      b,
      op({ manualChallenge: { side: "B", status: "SUCCESSFUL" } }),
      0,
    );
    expect(r.graphics.challenge).toMatchObject({
      status: "SUCCESSFUL",
      hand: "right",
    });
    expect(r.graphics.bug).toBe(false);
  });

  it("lets the operator override the feed rather than fight it", () => {
    const b = board({ challenge: { status: "REQUESTED", side: "A", since: 0 } });
    const r = direct(
      seedDirector(b),
      b,
      op({ manualChallenge: { side: "B", status: "UNSUCCESSFUL" } }),
      0,
    );
    expect(r.graphics.challenge).toMatchObject({ status: "UNSUCCESSFUL", hand: "right" });
  });

  it("clears everything else while a card is up", () => {
    const before = board();
    const b = board({
      challenge: { status: "REVIEW", side: "A", since: 0 },
      recentSubstitutions: [sub()],
      scoreA: 24,
      scoreB: 20,
    });
    b.teamA.timeoutsTaken = 1;
    const r = direct(seedDirector(before), b, op(), 1000);
    expect(r.graphics).toMatchObject({
      bug: false,
      substitution: null,
      timeout: null,
      keyMoment: null,
    });
    expect(r.graphics.challenge).not.toBeNull();
  });
});

describe("key moment", () => {
  it("coexists with the bug", () => {
    const b = board({ scoreA: 24, scoreB: 20 });
    const r = direct(seedDirector(b), b, op(), 0);
    expect(r.graphics.bug).toBe(true);
    expect(r.graphics.keyMoment).toMatchObject({ hand: "left", text: "SET POINT" });
  });
});

/**
 * The motion rehearsals (spec/48 G4). `?demo=sideout` and `?demo=point` are the
 * only two demos that drive the BOARD rather than force a graphic on, because
 * what they rehearse — a side-out and a point — is movement rather than a panel.
 * Without them the first time anyone sees the ball fly is during a live rally.
 */
describe("motion rehearsals", () => {
  it("are reachable from ?demo=", () => {
    expect(parseDemo("sideout")).toBe("sideout");
    expect(parseDemo("point")).toBe("point");
    expect(parseDemo("sidout")).toBeNull();
  });

  it("draw the bug and nothing else", () => {
    const b = board();
    for (const demo of ["sideout", "point"] as const) {
      const g = demoGraphics(demo, b, null);
      expect(g, demo).toEqual({ ...NOTHING, bug: true });
    }
  });

  it("flip the serving side, and hold each side long enough to see it land", () => {
    const b = board({ serving: "A" });
    const serves = Array.from(
      { length: 7 },
      (_, beat) => demoBoard("sideout", b, beat).serving,
    );
    // 900 ms a beat, three beats a side: the flight is 850 ms, so the ball rests
    // visibly before it crosses back.
    expect(serves).toEqual(["A", "A", "A", "B", "B", "B", "A"]);
  });

  it("walk the score up, across 9 → 10, and back down again", () => {
    const b = board();
    const left = Array.from(
      { length: 12 },
      (_, beat) => demoBoard("point", b, beat).scoreA,
    );
    // Two beats a step. 12 → 8 at the end of the cycle is the ROLL-BACK, which
    // is what an undo and an overturned challenge look like and is otherwise
    // unwatchable on demand; 9 → 10 is the two-digit re-centring.
    expect(left).toEqual([8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 8, 8]);
  });

  it("never roll both cells on the same beat", () => {
    // A real rally scores one side. Two odometers turning at once hides which.
    const b = board();
    for (let beat = 1; beat < 12; beat++) {
      const prev = demoBoard("point", b, beat - 1);
      const now = demoBoard("point", b, beat);
      const moved =
        (prev.scoreA !== now.scoreA ? 1 : 0) + (prev.scoreB !== now.scoreB ? 1 : 0);
      expect(moved, `beat ${beat}`).toBeLessThan(2);
    }
  });

  it("leave every other demo's board alone", () => {
    const b = board();
    expect(demoBoard("sub", b, 3)).toBe(b);
    expect(demoBoard("timeout", b, 7)).toBe(b);
  });
});
