/**
 * The replay board (spec/44): a real match, always in progress, never VIS.
 *
 * The sweep at the bottom is the point of the whole thing. Stepping a full
 * cycle frame by frame and running each frame through the SAME mapper the live
 * boards use turns match 27550 — nine live-logged divergences, an on-court
 * wrong-server, a libero legally at position 1 while receiving — into a
 * permanent regression suite for the rotation stack.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The store owns the pipeline these tests exercise, and it imports the DB for
// the rotation log. The replay must never write to it — asserted below.
vi.mock("@/db", () => {
  const db = {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  return { db, dbTx: db, DB_SCHEMA: "public", IS_PROD_SCHEMA: true };
});

import {
  REPLAY_EPOCH_MS,
  REPLAY_MATCH_NO,
  REPLAY_SPEED,
  cycleMs,
  phaseAt,
  replayXml,
} from "@/lib/vis-live/replay";
import { buildBoardFromXml, __resetVisCaches } from "@/lib/vis-live/store";
import { __resetLineupStability } from "@/lib/vis-live/lineup-stability";
import {
  designatedLiberos,
  parseSetEvents,
  playerSides,
} from "@/lib/vis-live/events";
import { enforceLineups } from "@/lib/vis-live/serve-succession";
import { sixOf, type Side } from "@/lib/vis-live/rotation";
import { allTagAttrs, num, str, tagBlocks } from "@/lib/vis-live/parse";

const CYCLE = cycleMs();
const HOLD = 120_000;

/** A wall-clock instant `into` ms after the cycle that starts at the epoch. */
const at = (into: number) => REPLAY_EPOCH_MS + into;
/** A wall-clock instant during play, `virtual` feed-ms into the match. */
const during = (virtualMs: number) => at(HOLD + Math.floor(virtualMs / REPLAY_SPEED));

/** The play phase, sampled every `stepWallMs` of wall time. */
function* playFrames(stepWallMs = 2_000): Generator<number> {
  for (let p = HOLD; p < CYCLE - HOLD; p += stepWallMs) yield at(p);
}

/** The first play frame whose board satisfies `predicate`. */
function firstFrame(
  predicate: (board: ReturnType<typeof boardAt>) => boolean,
  stepWallMs = 1_000,
): { now: number; board: ReturnType<typeof boardAt> } {
  for (const now of playFrames(stepWallMs)) {
    const board = boardAt(now);
    if (predicate(board)) return { now, board };
  }
  throw new Error("no frame in the cycle satisfied the predicate");
}

/**
 * A frame, rendered the way a real board renders it: through the store's own
 * `buildBoardFromXml`, so the enforced rotation (spec/43), the stabiliser and
 * the mapper are all in the path. Calling the mapper directly instead would
 * test half the machinery and silently skip the half these tests exist for.
 */
const boardAt = (nowMs: number, opts?: { chaos?: boolean }) =>
  buildBoardFromXml(REPLAY_MATCH_NO, replayXml(nowMs, opts), {
    audit: false,
    now: nowMs,
  });

beforeEach(() => {
  __resetVisCaches();
  __resetLineupStability();
});

describe("the clock", () => {
  it("loops through warm-up, play and the final result", () => {
    expect(phaseAt(at(0)).phase).toBe("UPCOMING");
    expect(phaseAt(at(HOLD - 1)).phase).toBe("UPCOMING");
    expect(phaseAt(at(HOLD)).phase).toBe("PLAY");
    expect(phaseAt(at(CYCLE - HOLD)).phase).toBe("FINISHED");
    expect(phaseAt(at(CYCLE - 1)).phase).toBe("FINISHED");
    // ...and comes back round to the start.
    expect(phaseAt(at(CYCLE)).phase).toBe("UPCOMING");
    expect(phaseAt(at(CYCLE)).cycleIndex).toBe(phaseAt(at(0)).cycleIndex + 1);
  });

  it("is a pure function of the wall clock, so instances cannot disagree", () => {
    // No stored state, no scheduling: two "instances" at the same instant
    // compute the same frame, and the same instant always gives the same XML.
    const now = during(600_000);
    expect(replayXml(now)).toBe(replayXml(now));
    expect(phaseAt(now)).toEqual(phaseAt(now));
    // The same offset one cycle later is the same moment of the match.
    expect(phaseAt(now).tMs).toBe(phaseAt(now + CYCLE).tMs);
  });

  it("runs the match faster than real time, but a cycle is still a sitting", () => {
    expect(REPLAY_SPEED).toBeGreaterThan(1);
    expect(CYCLE).toBeGreaterThan(10 * 60_000);
    expect(CYCLE).toBeLessThan(60 * 60_000);
  });
});

describe("golden frames", () => {
  it("shows a fixture waiting to start, with no score", () => {
    const board = boardAt(at(1_000));
    expect(board.status).toBe("UPCOMING");
    expect(board.scoreA).toBe(0);
    expect(board.scoreB).toBe(0);
    expect(board.currentSet).toBeNull();
    expect(board.teamA.code).toBe("QAT");
    expect(board.teamB.code).toBe("VEN");
  });

  it("names the first server before a single rally has been played", () => {
    // The one moment `Set@NoServingTeam` means "who serves first" (spec/42),
    // and the replay has to pass through it for the store to observe it.
    const xml = replayXml(during(1_000));
    const set = tagBlocks(xml, "Set")[0];
    expect(set).toBeDefined();
    expect((set.inner.match(/<Rally\b/g) ?? []).length).toBe(0);
    expect(str(set.attrs, "NoServingTeam")).not.toBeNull();
    const board = buildBoardFromXml(REPLAY_MATCH_NO, xml, {
      audit: false,
      now: during(1_000),
    });
    expect(board.status).toBe("LIVE");
    expect(board.serving).not.toBeNull();
  });

  it("counts the allowances down from full rather than starting them spent", () => {
    // The capture's own Set element carries the FINAL counters; a frame that
    // passed them through would open the match with the time-outs already gone.
    const opening = boardAt(during(1_000));
    expect(opening.teamA.timeoutsTaken).toBe(0);
    expect(opening.teamA.timeoutsRemaining).toBe(2);
    expect(opening.teamA.substitutionsUsed).toBe(0);
    const spent = firstFrame((b) => b.teamA.timeoutsTaken > 0);
    expect(spent.board.teamA.timeoutsRemaining).toBeLessThan(2);
  });

  it("advances the score and the statistics as the match is played", () => {
    const points = (b: ReturnType<typeof boardAt>) =>
      [...b.teamA.players, ...b.teamB.players].reduce((n, p) => n + p.points, 0);
    const early = firstFrame((b) => b.scoreA + b.scoreB >= 5).board;
    const later = firstFrame((b) => b.scoreA + b.scoreB >= 20).board;
    expect(early.scoreA + early.scoreB).toBeLessThan(later.scoreA + later.scoreB);
    expect(points(early)).toBeGreaterThan(0);
    expect(points(early)).toBeLessThan(points(later));
  });

  it("reaches a set break, credits the set, and starts the next one", () => {
    const brk = firstFrame((b) => b.inSetBreak);
    expect(brk.board.status).toBe("LIVE");
    expect(brk.board.setsWonA + brk.board.setsWonB).toBe(1);
    expect(brk.board.lastFinishedSet).not.toBeNull();

    const next = firstFrame((b) => (b.currentSet ?? 0) >= 2 && !b.inSetBreak);
    expect(next.board.currentSet).toBe(2);
    expect(next.now).toBeGreaterThan(brk.now);
  });

  it("ends on the real result, and then goes round again", () => {
    const done = boardAt(at(CYCLE - 1_000));
    expect(done.status).toBe("FINISHED");
    expect(done.setsWonA).toBe(0);
    expect(done.setsWonB).toBe(3);
    expect(done.sets).toHaveLength(3);
    expect(done.sets.every((s) => s.winner === "B")).toBe(true);
    // One millisecond into the next cycle it is a fixture again.
    expect(boardAt(at(CYCLE + 1_000)).status).toBe("UPCOMING");
  });

  it("never touches VIS", async () => {
    // Not "should not" — cannot: the module has no transport in it at all.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    replayXml(during(1_500_000));
    boardAt(during(1_500_000));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the version handshake works against the replay too", () => {
  it("stands still while nothing happens and rises when something does", () => {
    const version = (xml: string) => num(allTagAttrs(xml, "VolleyLive")[0], "Version");
    const quiet = during(600_000);
    expect(version(replayXml(quiet))).toBe(version(replayXml(quiet + 1)));
    expect(version(replayXml(during(600_000)))).toBeLessThan(
      version(replayXml(during(1_200_000))),
    );
  });
});

/** Everything the sweep needs to judge one frame, parsed from that frame. */
function inspect(xml: string) {
  const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
  const noTeamA = num(match, "NoTeamA", -1);
  const noTeamB = num(match, "NoTeamB", -2);
  const sides = playerSides(xml, noTeamA, noTeamB);
  const sets = tagBlocks(xml, "Set").sort(
    (a, b) => num(a.attrs, "No") - num(b.attrs, "No"),
  );
  const latest = sets[sets.length - 1] ?? null;
  if (!latest) return null;
  const head = latest.inner.split("<Events")[0];
  const startingFor = (noTeam: number) => {
    const row = allTagAttrs(head, "LineUp").find(
      (l) => num(l, "NoTeam", -99) === noTeam,
    );
    return row ? sixOf(row) : null;
  };
  const events = parseSetEvents(latest.inner, { noTeamA, noTeamB, sides });
  return {
    sets,
    latest,
    sides,
    events,
    enforced: enforceLineups({
      events,
      startingLineups: { A: startingFor(noTeamA), B: startingFor(noTeamB) },
      liberos: designatedLiberos(latest.inner),
      sides,
      remembered: null,
    }),
    liberos: designatedLiberos(latest.inner),
  };
}

describe("the full-cycle sweep", () => {
  // Every frame of one whole loop, at a resolution fine enough that no rally is
  // stepped over: rallies in this match are 5-25 seconds of feed time apart.
  const STEP_WALL_MS = 500;

  // A full cycle at this resolution is a few thousand frames, each one a whole
  // payload built and mapped. Slower than a unit test and worth every second.
  const SWEEP_TIMEOUT = 120_000;

  it("stays coherent from the first whistle to the last, and round again", () => {
    let prevSet = 0;
    let prevScore = -1;
    let prevVersion = -1;
    let sawLive = false;
    let sawBreak = false;
    let sawFinished = false;
    let frames = 0;

    for (let p = 0; p < CYCLE; p += STEP_WALL_MS) {
      const now = at(p);
      const frame = phaseAt(now);
      const xml = replayXml(now);
      const board = buildBoardFromXml(REPLAY_MATCH_NO, xml, { audit: false, now });
      frames++;

      // The phase schedule and the board agree about what is happening.
      if (frame.phase === "UPCOMING") expect(board.status).toBe("UPCOMING");
      if (frame.phase === "FINISHED") expect(board.status).toBe("FINISHED");
      if (frame.phase === "PLAY") {
        expect(board.status).toBe("LIVE");
        sawLive = true;
        if (board.inSetBreak) sawBreak = true;
        // Sets only ever go forwards, and the score only ever goes forwards
        // within a set.
        const set = board.currentSet ?? 0;
        expect(set).toBeGreaterThanOrEqual(prevSet);
        const score = board.scoreA + board.scoreB;
        if (set === prevSet) expect(score).toBeGreaterThanOrEqual(prevScore);
        prevSet = set;
        prevScore = score;
      }
      if (board.status === "FINISHED") sawFinished = true;

      const version = num(allTagAttrs(xml, "VolleyLive")[0], "Version");
      expect(version).toBeGreaterThanOrEqual(prevVersion);
      prevVersion = version;
    }

    expect(frames).toBeGreaterThan(1000);
    expect(sawLive && sawBreak && sawFinished).toBe(true);
  }, SWEEP_TIMEOUT);

  it("puts the player who actually serves at position 1, on every frame", () => {
    // The spec/43 property, end to end through the replay: for each frame, the
    // enforced position 1 of the side about to serve must be the player the
    // NEXT recorded rally says served. The one documented exception is 27550's
    // on-court wrong-server fault, which no model can predict.
    const anomalies: string[] = [];
    let checked = 0;

    for (let p = HOLD; p < CYCLE - HOLD; p += STEP_WALL_MS) {
      const now = at(p);
      const parsed = inspect(replayXml(now));
      if (!parsed) continue;
      const { events, enforced, sides } = parsed;
      if (enforced.basis !== "enforced") continue;

      // What the capture says happens next in this set.
      const played = events.rallies.length;
      const setNo = num(parsed.latest.attrs, "No", 0);
      const nextRally = FULL_RALLIES.get(setNo)?.[played];
      if (!nextRally?.server) continue;
      const side = sides.get(nextRally.server);
      const six = side ? enforced[side] : null;
      if (!side || !six) continue;

      // A substitution is published when it is made, and some are recorded
      // INSIDE the rally they precede — so at this instant the feed may not yet
      // have said that the player about to serve is even on court. The board
      // cannot know what it has not been told, and neither can this assertion.
      if (nextRally.subsBefore.length !== events.trailingSubs.length) continue;

      checked++;
      if (six[0] !== nextRally.server) {
        anomalies.push(
          `set ${num(parsed.latest.attrs, "No", 0)} rally ${played + 1}: ` +
            `served ${nextRally.server}, board had ${six[0]}`,
        );
      }
    }

    expect(checked).toBeGreaterThan(500);
    // Every miss is the same one rally, seen from however many frames sit
    // between the rally before it and the rally itself.
    expect(new Set(anomalies)).toEqual(
      new Set(["set 1 rally 15: served 232496, board had 232492"]),
    );
  }, SWEEP_TIMEOUT);

  it("hides the feed's rewrite window: chaos changes nothing on screen", () => {
    // Chaos republishes the previous rally's line-ups for a moment after each
    // rally — the behaviour spec/42 measured live and blamed for a server
    // appearing and vanishing. Enforcement does not read that lineup, so the
    // rendered six must be identical frame for frame.
    for (let p = HOLD; p < CYCLE - HOLD; p += 5_000) {
      const now = at(p);
      const calm = boardAt(now);
      const chaotic = boardAt(now, { chaos: true });
      expect(chaotic.teamA.players).toEqual(calm.teamA.players);
      expect(chaotic.teamB.players).toEqual(calm.teamB.players);
      expect(chaotic.scoreA).toBe(calm.scoreA);
      expect(chaotic.serving).toBe(calm.serving);
    }
  }, SWEEP_TIMEOUT);

  it("never seats a designated libero in the serving position", () => {
    let serving = 0;
    for (let p = HOLD; p < CYCLE - HOLD; p += 2_000) {
      const board = boardAt(at(p));
      if (!board.serving) continue;
      serving++;
      const six = board.serving === "A" ? board.teamA.players : board.teamB.players;
      if (six.length === 0) continue;
      expect(six[0].isLibero).toBe(false);
    }
    expect(serving).toBeGreaterThan(100);
  }, SWEEP_TIMEOUT);
});

/**
 * Every rally of the donor, per set, taken from the END of the cycle — the
 * frame at which the whole match is on the record. The sweep compares its
 * predictions against these.
 */
const FULL_RALLIES = (() => {
  const xml = replayXml(REPLAY_EPOCH_MS + CYCLE - 1_000);
  const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
  const noTeamA = num(match, "NoTeamA", -1);
  const noTeamB = num(match, "NoTeamB", -2);
  const sides = playerSides(xml, noTeamA, noTeamB);
  const out = new Map<number, ReturnType<typeof parseSetEvents>["rallies"]>();
  for (const s of tagBlocks(xml, "Set")) {
    out.set(
      num(s.attrs, "No", 0),
      parseSetEvents(s.inner, { noTeamA, noTeamB, sides }).rallies,
    );
  }
  return out;
})();

/** Kept honest: the sweep is worthless if the donor lost its awkward parts. */
describe("the donor still contains what it was chosen for", () => {
  it("carries the wrong-server rally, a receiving libero at P1, and subs", () => {
    const rallies = FULL_RALLIES.get(1)!;
    expect(rallies).toHaveLength(41);
    expect(rallies[14].server).toBe("232496"); // the on-court anomaly
    expect(rallies[12].lineup.B?.[0]).toBe("232497"); // libero receiving at P1
    expect(rallies.some((r) => r.subsBefore.length > 0)).toBe(true);
    expect([...FULL_RALLIES.values()].reduce((n, r) => n + r.length, 0)).toBe(130);
  });
});

describe("the replay is walled off from the evidence table", () => {
  it("uses a match number VIS can never issue", () => {
    // `vis_rotation_log` rows are keyed by match number, so the replay's must
    // be impossible upstream — belt to the `audit: false` braces in the store.
    expect(REPLAY_MATCH_NO).toBeLessThan(0);
  });

  it("never emits a Side type it cannot attribute", () => {
    const parsed = inspect(replayXml(during(2_000_000)))!;
    const seen = new Set<Side>([...parsed.sides.values()]);
    expect([...seen].sort()).toEqual(["A", "B"]);
  });
});
