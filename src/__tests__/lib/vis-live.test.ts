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
  FIVB_PER_SET,
  inferStatus,
  mapVolleyLive,
  mapVolleyMatch,
  mapVolleyMatchList,
} from "@/lib/vis-live/board-data";
import { allTagAttrs, decodeXml, num, tagBlocks } from "@/lib/vis-live/parse";
import { MOCK_MATCH_NO, mockLiveXml } from "@/lib/vis-live/mock";

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
    expect(BOARD_OPTIONS).toBe(2584); // 8 rosters | 16 line-ups | 512 events | 2048 stats
    expect(volleyLiveEnvelope(27062)).toContain('Type="GetVolleyLive"');
    expect(volleyLiveEnvelope(27062)).toContain('Options="2584"');
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
    expect(board.teamA.timeoutsTaken).toBeGreaterThanOrEqual(0);
    expect(board.teamA.timeoutsTaken).toBeLessThanOrEqual(2); // FIVB 15.1
    expect(board.teamB.substitutionsUsed).toBeLessThanOrEqual(6); // FIVB 15.1
  });

  it("counts the allowances DOWN, from what VIS says was used", () => {
    // The fixture's deciding set: both sides spent both time-outs; A made 4
    // substitutions with 4 still to come, B made 6 with 2 left.
    expect(board.teamA.timeoutsTaken).toBe(2);
    expect(board.teamA.timeoutsRemaining).toBe(0);
    expect(board.teamB.timeoutsRemaining).toBe(0);
    expect(board.teamA.substitutionsUsed).toBe(4);
    expect(board.teamA.substitutionsRemaining).toBe(4);
    expect(board.teamB.substitutionsRemaining).toBe(2);
  });

  it("takes the feed's own remaining-substitution count, unclamped", () => {
    // 4 used AND 4 remaining — this event does not run to six, and forcing the
    // FIVB allowance on it would under-report what the teams actually have.
    expect(
      board.teamA.substitutionsUsed + board.teamA.substitutionsRemaining,
    ).toBeGreaterThan(FIVB_PER_SET.substitutions);
  });

  it("spends a challenge only when it was REFUSED, never merely requested", () => {
    // FIVB: a team that wins its challenge keeps the right. B requested two,
    // had one upheld and one refused, so exactly one is gone.
    expect(board.teamB.challengesRequested).toBe(2);
    expect(board.teamB.challengesRefused).toBe(1);
    expect(board.teamB.challengesRemaining).toBe(1);
    // A had both of its requests refused and has none left.
    expect(board.teamA.challengesRefused).toBe(2);
    expect(board.teamA.challengesRemaining).toBe(0);
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
  // Strip the match end timestamp AND give the deciding set back to nobody, by
  // decrementing the winner's MatchPointsA from 3 to 2. The payload is then
  // indistinguishable from one arriving MID-SET, which is the state we cannot
  // capture on demand.
  //
  // Note what is deliberately NOT stripped: `Set@Duration`. VIS stamps elapsed
  // time on a set that is being PLAYED, so a live payload carries it — the
  // assumption that it means "complete" is what stranded every board on the
  // statistics screen (spec/37).
  const liveXml = BOARD_XML.replace(/\sEndDateTime="[^"]*"/, "").replace(
    /(<Match\b[^>]*?)\sMatchPointsA="3"/,
    '$1 MatchPointsA="2"',
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

// ── spec/35: current rotation, and the validation mock ───────────────────────

describe("current rotation from the events stream (spec/35 W3)", () => {
  const ROT_XML = fixture("volley-live-rotation-finished");

  it("takes the LAST line-up of the set, not the registered starting six", () => {
    // The Options-2584 payload carries a LineUp per rally; the last one is the
    // rotation on court, and it must differ from the first in a played set.
    const first = /<Set\b[^>]*No="1"[^>]*>([\s\S]*?)<\/Set>/.exec(ROT_XML)![1];
    const lineups = [...first.matchAll(/<LineUp\b[^>]*NoTeam="8713"[^>]*/g)].map((m) => m[0]);
    expect(lineups.length).toBeGreaterThan(10); // per-rally, not per-set
    expect(lineups[0]).not.toBe(lineups[lineups.length - 1]);

    const board = mapVolleyLive(ROT_XML, 27062, Date.parse("2026-08-17T06:00:00Z"));
    // Position 1 comes from the LAST line-up (NoPlayer1 = 219116 there).
    expect(board.teamA.players).toHaveLength(6);
    expect(board.teamA.players[0].position).toBe(1);
    expect(board.teamA.players.every((p) => p.name !== "")).toBe(true);
  });

  it("still works on a payload carrying only the registered six", () => {
    // The older capture has one LineUp per team per set; first === last, so the
    // same code path yields the starting rotation.
    const board = mapVolleyLive(BOARD_XML, 27062, Date.parse("2026-08-17T06:00:00Z"));
    expect(board.teamA.players).toHaveLength(6);
  });
});

describe("rotation after a side-out — regression, spec/37", () => {
  // Modelled on match 27547, 2026-08-19. VIS attaches each rally's OWN rotation
  // and publishes it only once that rally has finished, so the newest lineup is
  // always the previous rally's. Argentina won rally 59 on a side-out and
  // rotated before serving rally 60 — the board had 228085 on serve when the
  // court had 228081 there.
  const ARG = [228085, 228081, 232273, 228091, 228090, 228078];
  const POL = [218115, 218105, 226087, 238071, 226085, 237960];
  const lu = (l: number[], team: number) =>
    `<LineUp ${l.map((p, j) => `NoPlayer${j + 1}="${p}"`).join(" ")} NoTeam="${team}" />`;

  /** A whole set's rally stream from 0-0, as the feed always sends it. */
  const build = (scores: [number, number][]) => {
    const rallies = scores
      .map((sc, i) => `<Rally No="${i + 1}" PointsTeamA="${sc[0]}" PointsTeamB="${sc[1]}">
        ${lu(ARG, 8692)}${lu(POL, 8687)}</Rally>`)
      .join("");
    const [a, b] = scores[scores.length - 1];
    return `<?xml version="1.0"?><Responses><VolleyLive PollDelay="20">
      <Match No="27547" NoTeamA="8692" NoTeamB="8687" BeginDateTime="2026-08-19T08:00:00Z"
             MatchPointsA="0" MatchPointsB="0">
        <Team No="8692" Code="ARG" Name="Argentina" />
        <Team No="8687" Code="POL" Name="Poland" />
        <Set No="1" NoServingTeam="8692" NoTeamAtLeft="8692" PointsTeamA="${a}" PointsTeamB="${b}">
          ${lu(ARG, 8692).replace("NoTeam=", 'NoLibero1="228078" NoTeam=')}
          <Events>${rallies}</Events>
        </Set>
      </Match></VolleyLive></Responses>`;
  };
  const at = Date.parse("2026-08-19T08:33:40Z");
  const names = (ns: number[]) => ns.map((n) => `#${n}`);

  it("advances the serving side one place when the serve has just changed hands", () => {
    // Poland took the previous rally, Argentina the last one: a side-out, so
    // Argentina has rotated on court before serving.
    const board = mapVolleyLive(build([[1, 0], [1, 1], [2, 1]]), 27547, at);
    expect(board.serving).toBe("A");
    expect(board.teamA.players.map((p) => p.name)).toEqual(
      names([228081, 232273, 228091, 228090, 228078, 228085]),
    );
    // The receiving side does not rotate.
    expect(board.teamB.players.map((p) => p.name)).toEqual(names(POL));
  });

  it("leaves the rotation alone while the same side keeps serving", () => {
    const board = mapVolleyLive(build([[1, 0], [2, 0], [3, 0]]), 27547, at);
    expect(board.teamA.players.map((p) => p.name)).toEqual(names(ARG));
  });

  it("rotates the other side when it is the one that broke serve", () => {
    const board = mapVolleyLive(build([[1, 0], [2, 0], [2, 1]]), 27547, at);
    expect(board.teamB.players.map((p) => p.name)).toEqual(
      names([218105, 226087, 238071, 226085, 237960, 218115]),
    );
    expect(board.teamA.players.map((p) => p.name)).toEqual(names(ARG));
  });

  it("does not guess from a single rally", () => {
    const board = mapVolleyLive(build([[1, 0]]), 27547, at);
    expect(board.teamA.players.map((p) => p.name)).toEqual(names(ARG));
  });

  it("still marks the libero, whose number only the set lineup carries", () => {
    const board = mapVolleyLive(build([[1, 0], [1, 1], [2, 1]]), 27547, at);
    expect(board.teamA.players.find((p) => p.name === "#228078")?.isLibero).toBe(true);
  });
});

describe("a set in play carries a Duration — regression, spec/37", () => {
  // Match 27547 (U17 Boys WCH, 2026-08-19) at 12-11 in set one, straight from
  // the feed: VIS had ALREADY stamped Duration="778" on the set being played.
  // Reading that as "the set is over" put every live board on the set-break
  // statistics screen within seconds of the first point and kept it there.
  const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?><Responses>
    <VolleyLive PollDelay="20">
      <Match No="27547" Status="5" NbRallies="23" NoTeamA="8692" NoTeamB="8687"
             BeginDateTime="2026-08-19T08:00:00Z" MatchPointsA="0" MatchPointsB="0"
             TimePlayed="333494">
        <Team No="8692" Code="ARG" Name="Argentina" />
        <Team No="8687" Code="POL" Name="Poland" />
        <Set BeginTimeOffset="0" No="1" Duration="778" NbRallies="23"
             NoServingTeam="8687" NoTeamAtLeft="8692" NoTeamAtRight="8687"
             PointsTeamA="12" PointsTeamB="11" TimePlayed="333494" />
      </Match>
    </VolleyLive></Responses>`;
  const board = mapVolleyLive(xml, 27547, Date.parse("2026-08-19T08:12:00Z"));

  it("is LIVE and NOT in a set break", () => {
    expect(board.status).toBe("LIVE");
    expect(board.inSetBreak).toBe(false);
  });

  it("leaves the set undecided, because the match has not been credited with it", () => {
    expect(board.setsWonA + board.setsWonB).toBe(0);
    expect(board.sets).toHaveLength(1);
    expect(board.sets[0].winner).toBeNull();
    expect(board.lastFinishedSet).toBeNull();
  });

  it("calls the break only once the set is credited to somebody", () => {
    const credited = xml.replace('MatchPointsA="0"', 'MatchPointsA="1"');
    const after = mapVolleyLive(credited, 27547, Date.parse("2026-08-19T08:12:00Z"));
    expect(after.inSetBreak).toBe(true);
    expect(after.sets[0].winner).toBe("A");
  });
});

describe("validation mock — VNL 2025 QF Japan v Poland (spec/35 W9)", () => {
  const board = mapVolleyLive(mockLiveXml(), MOCK_MATCH_NO, Date.parse("2026-08-18T12:00:00Z"));

  it("reads as a LIVE match at its latest stage", () => {
    // The capture is a finished 3-0; the transform strips the match end stamp
    // and the last set's Duration so the board shows a match in progress.
    expect(board.status).toBe("LIVE");
    expect(board.currentSet).toBe(3);
    expect(board.scoreA).toBe(12);
    expect(board.scoreB).toBe(25);
    expect(board.inSetBreak).toBe(false);
  });

  it("carries the real teams, result and court sides", () => {
    expect(board.teamA.code).toBe("JPN");
    expect(board.teamB.code).toBe("POL");
    expect(board.setsWonA).toBe(0);
    // Two, not the capture's three: the third set is being played, so the match
    // has not been credited with it yet.
    expect(board.setsWonB).toBe(2);
    // Japan stood on the left in set 3 — what the U-shape rails follow.
    expect(board.teamAAtLeft).toBe(true);
    expect(board.serving).toBe("B"); // Poland served the last rally
  });

  it("shows a full six per side with names, jerseys and stats", () => {
    for (const t of [board.teamA, board.teamB]) {
      expect(t.players).toHaveLength(6);
      expect(t.players.every((p) => p.name !== "" && p.jersey != null)).toBe(true);
    }
    expect(board.stats).not.toBeNull();
    expect(board.stats!.attacksA).toBeGreaterThan(0);
    expect(board.stats!.attacksB).toBeGreaterThan(0);
  });

  it("keeps the two completed sets decided in the ladder", () => {
    expect(board.sets.slice(0, 2).map((s) => s.winner)).toEqual(["B", "B"]);
    expect(board.sets[2].winner).toBeNull(); // the "live" set
  });
});
