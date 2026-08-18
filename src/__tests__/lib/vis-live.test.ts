import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_OPTIONS,
  visRequest,
  volleyLiveEnvelope,
  volleyMatchEnvelope,
  volleyMatchListEnvelope,
} from "@/lib/vis-live/client";
import {
  inferStatus,
  mapVolleyLive,
  mapVolleyMatch,
  mapVolleyMatchList,
} from "@/lib/vis-live/board-data";
import { allTagAttrs, decodeXml, num, tagBlocks } from "@/lib/vis-live/parse";

/**
 * Fixtures are REAL VIS responses captured on 2026-08-18 (read-only Get*
 * requests): the U17 girls' world final 27062, a not-yet-started AVC women's
 * match 28803, and the full 1670 schedule. Every mapping rule in spec/34 is
 * pinned against them, because the alternative is discovering a mis-mapped
 * scoreboard on a TV in front of an arena.
 */
const fixture = (name: string) =>
  readFileSync(
    new URL(`../fixtures/vis/${name}.xml`, import.meta.url),
    "utf-8",
  );

const BOARD_XML = fixture("volley-live-board-finished");
const SCHEDULED_XML = fixture("volley-match-scheduled");
const LIST_XML = fixture("volley-match-list-1670");

describe("vis parse helpers", () => {
  it("decodes the XML entities VIS actually emits", () => {
    expect(decodeXml("Team &amp; Co &lt;2&gt; &#233;")).toBe("Team & Co <2> é");
  });

  it("treats absent and empty numeric attributes as the fallback", () => {
    // VIS omits zero-valued attributes and sends "" for not-yet-known numbers.
    expect(num({ A: "" }, "A", 0)).toBe(0);
    expect(num({}, "NbTimeoutTeamA", 0)).toBe(0);
    expect(num({ A: "7" }, "A")).toBe(7);
  });

  it("scopes nested rows to their parent block", () => {
    // Players are nested per Team; a flat scan would merge both squads.
    const teams = tagBlocks(BOARD_XML, "Team");
    expect(teams).toHaveLength(2);
    const perTeam = teams.map((t) => allTagAttrs(t.inner, "Player").length);
    expect(perTeam[0]).toBeGreaterThan(6);
    expect(perTeam.reduce((a, b) => a + b, 0)).toBe(
      allTagAttrs(BOARD_XML, "Player").length,
    );
  });
});

describe("vis client envelopes", () => {
  it("asks for the lean board bitmask, not the whole live store", () => {
    expect(BOARD_OPTIONS).toBe(2072); // 8 rosters | 16 line-ups | 2048 stats
    expect(volleyLiveEnvelope(27062)).toContain('Type="GetVolleyLive"');
    expect(volleyLiveEnvelope(27062)).toContain('Options="2072"');
  });

  it("builds read-only envelopes for every request it makes", () => {
    for (const env of [
      volleyLiveEnvelope(1),
      volleyMatchEnvelope(1),
      volleyMatchListEnvelope(1),
    ]) {
      expect(env).toMatch(/^<Requests><Request Type="Get/);
    }
  });

  it("refuses to send anything that is not a Get request", async () => {
    // The 2026-07-29 incident in one assertion: a write must be unreachable
    // from this module, not merely absent from it.
    await expect(
      visRequest('<Requests><Request Type="UploadVolleyLiveScore" NoMatch="1"/></Requests>'),
    ).rejects.toThrow(/read-only/i);
  });
});

describe("mapVolleyLive — finished match", () => {
  const board = mapVolleyLive(BOARD_XML, 27062, Date.parse("2026-08-17T06:00:00Z"));

  it("reads the result and the teams", () => {
    expect(board.status).toBe("FINISHED");
    expect(board.setsWonA).toBe(3);
    expect(board.setsWonB).toBe(0);
    expect(board.teamA.code).toBe("USA");
    expect(board.teamB.code).toBe("TUR");
    // Non-ASCII team names must survive the parser.
    expect(board.teamB.name).toBe("Türkiye");
  });

  it("builds the set ladder with winners", () => {
    expect(board.sets).toHaveLength(3);
    expect(board.sets[0]).toMatchObject({ setNumber: 1, scoreA: 25, scoreB: 23, winner: "A" });
    // A finished match has every set decided, including the last.
    expect(board.sets[2].winner).toBe("A");
  });

  it("shows no serve indicator once the match is over", () => {
    expect(board.serving).toBeNull();
  });

  it("lists the six on court with jerseys, names and points", () => {
    expect(board.teamA.players).toHaveLength(6);
    expect(board.teamA.players.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const p of board.teamA.players) {
      expect(p.name).not.toBe("");
      expect(p.jersey).not.toBeNull();
      expect(p.points).toBeGreaterThanOrEqual(0);
    }
    // Somebody scored — otherwise the PTS column is silently dead.
    const total = [...board.teamA.players, ...board.teamB.players].reduce(
      (sum, p) => sum + p.points,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("reads the interruption counters of the current set", () => {
    expect(board.teamA.timeouts).toBeGreaterThanOrEqual(0);
    expect(board.teamA.timeouts).toBeLessThanOrEqual(2); // FIVB 15.1
    expect(board.teamB.substitutions).toBeLessThanOrEqual(6); // FIVB 15.1
  });

  it("honours the feed's own poll delay", () => {
    expect(board.pollDelaySeconds).toBe(20);
  });

  it("knows which team stands on the left of the court", () => {
    // Fixture set 3: NoTeamAtLeft="8713" = team A — the U-shape rails follow this.
    expect(board.teamAAtLeft).toBe(true);
  });

  it("derives the team totals for the break screen from the player rows", () => {
    // Cross-checked against the full 65535 payload's TeamStatistics: USA
    // spike 45 + back-row 6, block 12, serve 9; OpponentErrors from the thin
    // team row itself.
    expect(board.stats).not.toBeNull();
    expect(board.stats!.attacksA).toBe(51);
    expect(board.stats!.blocksA).toBe(12);
    expect(board.stats!.servesA).toBe(9);
    expect(board.stats!.opponentErrorsA).toBe(9);
    expect(board.stats!.attacksB).toBe(27);
    expect(board.stats!.opponentErrorsB).toBe(21);
  });

  it("is not in a set break once the match is over", () => {
    expect(board.inSetBreak).toBe(false);
    expect(board.lastFinishedSet).toMatchObject({ setNumber: 3, scoreA: 25 });
  });
});

describe("mapVolleyLive — set break (set over, match not)", () => {
  // Only the match end timestamp stripped: the last set keeps its Duration,
  // which is exactly what the feed shows between sets.
  const breakXml = BOARD_XML.replace(/\sEndDateTime="[^"]*"/, "");
  const board = mapVolleyLive(breakXml, 27062, Date.parse("2026-08-17T00:10:00Z"));

  it("detects the break from the set's stamped Duration", () => {
    expect(board.status).toBe("LIVE");
    expect(board.inSetBreak).toBe(true);
    expect(board.lastFinishedSet).toMatchObject({
      setNumber: 3,
      scoreA: 25,
      scoreB: 23,
      winner: "A",
    });
  });

  it("gives the ended set its winner in the ladder", () => {
    expect(board.sets[2].winner).toBe("A");
  });
});

describe("mapVolleyLive — the same match treated as live", () => {
  // Strip the match end timestamp AND the last set's Duration: the payload is
  // then indistinguishable from one arriving MID-SET, which is the state we
  // cannot capture on demand. (Duration present = the set is over — that case
  // has its own describe below.)
  const liveXml = BOARD_XML.replace(/\sEndDateTime="[^"]*"/, "").replace(
    /(<Set [^>]*No="3"[^>]*?)\sDuration="[^"]*"/,
    "$1",
  );
  const board = mapVolleyLive(liveXml, 27062, Date.parse("2026-08-17T00:10:00Z"));

  it("infers LIVE from the timestamps, never from the status enum", () => {
    expect(board.status).toBe("LIVE");
  });

  it("leaves the set in progress undecided even at a winning score", () => {
    const last = board.sets[board.sets.length - 1];
    expect(last.scoreA).toBeGreaterThan(last.scoreB);
    // VIS can still correct a live set — dimming it early would be wrong on a
    // TV for as long as it took to fix.
    expect(last.winner).toBeNull();
  });

  it("derives the serving side from the current set", () => {
    expect(board.serving).toBe("A"); // NoServingTeam === NoTeamA in the fixture
  });

  it("keeps the current-set score on the big plates", () => {
    expect(board.currentSet).toBe(3);
    expect(board.scoreA).toBe(board.sets[2].scoreA);
  });
});

describe("inferStatus", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  it("ends on EndDateTime", () => {
    expect(inferStatus({ EndDateTime: "2026-08-19T11:00:00Z" }, now)).toBe("FINISHED");
  });
  it("is live once a start time has passed", () => {
    expect(inferStatus({ BeginDateTime: "2026-08-19T11:00:00Z" }, now)).toBe("LIVE");
  });
  it("is upcoming while the start time is ahead", () => {
    expect(inferStatus({ BeginDateTime: "2026-08-19T13:00:00Z" }, now)).toBe("UPCOMING");
  });
  it("is upcoming with no timestamps at all", () => {
    expect(inferStatus({}, now)).toBe("UPCOMING");
  });
});

describe("mapVolleyMatch — the pre-start fallback", () => {
  const board = mapVolleyMatch(SCHEDULED_XML, 28803, Date.parse("2026-08-18T10:00:00Z"));

  it("renders a 0-0 frame with the teams and the local kick-off", () => {
    expect(board).not.toBeNull();
    expect(board!.status).toBe("UPCOMING");
    expect(board!.teamA.name).toBe("Chinese Taipei");
    expect(board!.teamB.name).toBe("Iran");
    expect(board!.scoreA).toBe(0);
    expect(board!.currentSet).toBeNull();
    expect(board!.serving).toBeNull();
    expect(board!.scheduledLocal).toBe("2026-08-21 10:00");
    expect(board!.sets).toEqual([]);
  });
});

describe("mapVolleyMatchList", () => {
  const rows = mapVolleyMatchList(LIST_XML);

  it("reads the whole schedule", () => {
    expect(rows).toHaveLength(46);
  });

  it("maps the opening match", () => {
    expect(rows[0]).toMatchObject({
      matchNo: 27547,
      teamAName: "Argentina",
      teamBName: "Poland",
      dateLocal: "2026-08-19",
      timeLocal: "11:00",
      status: "UPCOMING",
    });
  });

  it("calls a row with a result FINISHED, and a result-less non-scheduled row LIVE", () => {
    const finished = mapVolleyMatchList(
      '<VolleyballMatch No="1" Status="25" MatchResultText="3-0" TeamAName="A" TeamBName="B"/>',
    );
    expect(finished[0].status).toBe("FINISHED");
    // Unknown status codes must never hide a match that is under way.
    const running = mapVolleyMatchList(
      '<VolleyballMatch No="2" Status="7" TeamAName="A" TeamBName="B"/>',
    );
    expect(running[0].status).toBe("LIVE");
  });
});
