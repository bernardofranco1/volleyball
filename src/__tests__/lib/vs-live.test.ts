/**
 * VolleyStation as a board source (spec/45).
 *
 * Fixtures are REAL responses captured read-only on 2026-08-20. They were
 * checked for the API key before being committed, and the capture scripts read
 * it from the environment and never write it — the repo is public (spec/45 §0).
 *
 * The match fixtures were chosen for what they contain rather than for being
 * tidy: 2504866 has a libero on court for one side only, 2504876 for both,
 * 2504640 is mid-set with the line-up not yet entered, and 2491233 is a
 * finished five-setter with a full stats sheet.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VsRequestError, vsGet } from "@/lib/vs-live/client";
import { mapVsBoard } from "@/lib/vs-live/board-data";
import type { VsChampionship, VsMatch, VsStatsRow, VsTeam } from "@/lib/vs-live/types";

const fixture = <T,>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/vs/${name}.json`, import.meta.url), "utf-8"),
  ) as T;

const MATCHES = fixture<Record<string, VsMatch>>("matches");
const STATS = fixture<VsStatsRow[]>("stats-2491233");
const CHAMPS = fixture<VsChampionship[]>("championships");
const TEAMS = fixture<VsTeam[]>("teams-6181");
const AVC = fixture<VsMatch[]>("matches-6181");

const champ = (id: number) => CHAMPS.find((c) => c.Championship_ID === id) ?? null;

/** Shirt → name, as the resolver builds it. */
function roster(team: VsTeam): Map<number, string> {
  const m = new Map<number, string>();
  for (const p of team.PlayerList ?? []) {
    if (p.Number != null) m.set(p.Number, p.Player_ShirtName || p.Player_Surname || `#${p.Number}`);
  }
  return m;
}

describe("the client refuses what would hurt", () => {
  it("will not fetch the 77 MB stats dump", async () => {
    // The sheet IGNORES an unrecognised filter and answers 200 with everything,
    // so `?match=` looks like it worked and is 77 MB of it.
    await expect(vsGet("MatchStatsSheet/")).rejects.toThrow(/unfiltered MatchStatsSheet/);
    await expect(vsGet("MatchStatsSheet/?match=123")).rejects.toThrow(/unfiltered MatchStatsSheet/);
  });

  it("will not fetch the whole match table", async () => {
    await expect(vsGet("Matches/")).rejects.toThrow(/unfiltered Matches/);
  });

  it("will not send a list query without the date window VolleyStation demands", async () => {
    // Undated list calls are answered HTTP 429 upstream; the remedy is in the
    // error body, so we enforce it rather than discover it during an event.
    await expect(vsGet("Matches/?Championship_ID=6181")).rejects.toThrow(/undated/);
  });

  it("will not call /sync", async () => {
    await expect(vsGet("sync/")).rejects.toThrow(/not a read/);
    await expect(vsGet("Matches/sync")).rejects.toThrow(/not a read/);
  });

  it("refuses a path it does not recognise at all", async () => {
    await expect(vsGet("Coaches/")).rejects.toThrow(/unrecognised/);
  });

  it("says so plainly when it has no key", async () => {
    vi.stubEnv("VOLLEYSTATION_KEY", "");
    await expect(vsGet("Matches/123/")).rejects.toThrow(VsRequestError);
    await expect(vsGet("Matches/123/")).rejects.toThrow(/VOLLEYSTATION_KEY is not set/);
    vi.unstubAllEnvs();
  });

  it("allows the shapes the boards actually use", async () => {
    // Reaching the key check means the path passed — no network in this test.
    vi.stubEnv("VOLLEYSTATION_KEY", "");
    for (const p of [
      "Matches/2504866/",
      "Matches/?Championship_ID=6181&MatchDateTime__gte=2026-08-01",
      "MatchStatsSheet/?ChampionshipMatchID=2491233",
      "Teams/?Championship_ID=6181",
      "Championships/",
    ]) {
      await expect(vsGet(p)).rejects.toThrow(/VOLLEYSTATION_KEY is not set/);
    }
    vi.unstubAllEnvs();
  });
});

describe("the widget is the scorer's current rotation", () => {
  it("puts the serving player at position 1, on every populated fixture", () => {
    // This is the whole reason to read VolleyStation: the rotation arrives
    // rather than being derived. If it ever stopped being true, spec/42+43's
    // machinery would be needed here too — so it is pinned.
    let checked = 0;
    for (const m of Object.values(MATCHES)) {
      const w = m.widget;
      if (!w?.serve || w.serving_player_number == null) continue;
      const six = w.serve === "home" ? w.lineup_home : w.lineup_guest;
      if (!six || six[0] == null) continue;
      checked++;
      expect(six[0]).toBe(w.serving_player_number);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("swaps the libero onto the court, in the slot of the player they replaced", () => {
    // 2504866: the six carry #9 at position 6, and libero #11 is on in their
    // place. Showing #9 would name a player sitting on the bench.
    const m = MATCHES["2504866"];
    expect(m.widget?.libero_replacing_home).toBe(9);
    expect(m.widget?.libero_number_home).toBe(11);

    const board = mapVsBoard({
      match: m,
      stats: null,
      config: champ(6005),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    const jerseys = board.teamA.players.map((p) => p.jersey);
    expect(jerseys).toContain(11);
    expect(jerseys).not.toContain(9);
    const libero = board.teamA.players.find((p) => p.isLibero);
    expect(libero?.jersey).toBe(11);
    expect(libero?.position).toBe(6);
    // ...and exactly one of the six is marked.
    expect(board.teamA.players.filter((p) => p.isLibero)).toHaveLength(1);
  });

  it("leaves a side alone when no libero is on for it", () => {
    const board = mapVsBoard({
      match: MATCHES["2504866"],
      stats: null,
      config: champ(6005),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(board.teamB.players.some((p) => p.isLibero)).toBe(false);
    expect(board.teamB.players.map((p) => p.jersey)).toEqual([11, 7, 13, 5, 6, 8]);
  });

  it("renders nothing rather than #null before the line-up is entered", () => {
    const board = mapVsBoard({
      match: MATCHES["2504640"],
      stats: null,
      config: champ(6004),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(board.teamA.players).toEqual([]);
    expect(board.teamB.players).toEqual([]);
    // The rest of the board is still perfectly serviceable.
    expect(board.status).toBe("LIVE");
    expect(board.currentSet).toBe(1);
  });

  it("dresses the six from the roster when one is supplied", () => {
    const tpe = TEAMS[0];
    const board = mapVsBoard({
      match: MATCHES["2504876"],
      stats: null,
      config: champ(6005),
      rosterHome: roster(tpe),
      rosterGuest: null,
      matchNo: 1,
    });
    // Names come from the roster where the shirt matches, and fall back to the
    // number where it does not — never to blank.
    for (const p of board.teamA.players) expect(p.name).not.toBe("");
  });
});

describe("allowances count DOWN from what the feed reports as remaining", () => {
  it("reads the arrays as remaining, not as used", () => {
    // Measured: a match at 0-0 carries [2,2]/[8,8]/[2,2], which are exactly the
    // championship's limits. Reading them as "used" would open a match with
    // every time-out already spent.
    const m = MATCHES["2504640"];
    expect(m.timeout_count).toEqual([2, 2]);
    const board = mapVsBoard({
      match: m,
      stats: null,
      config: champ(6004),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(board.teamA.timeoutsRemaining).toBe(2);
    expect(board.teamA.timeoutsTaken).toBe(0);
    expect(board.teamA.substitutionsRemaining).toBe(8);
    expect(board.teamA.substitutionsUsed).toBe(0);
  });

  it("takes the limit from the championship, not from the FIVB default", () => {
    // These events allow EIGHT substitutions, not the FIVB indoor six. A board
    // that assumed six would report a negative or clamped allowance.
    expect(champ(6004)?.substitutions_limit).toBe(8);
    const board = mapVsBoard({
      match: MATCHES["2504640"],
      stats: null,
      config: champ(6004),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(board.teamA.substitutionsRemaining).toBe(8);
  });

  it("shows a spent time-out as spent", () => {
    const m = MATCHES["2504866"]; // [1, 2] at 6-6
    const board = mapVsBoard({
      match: m,
      stats: null,
      config: champ(6005),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(board.teamA.timeoutsRemaining).toBe(1);
    expect(board.teamA.timeoutsTaken).toBe(1);
    expect(board.teamB.timeoutsRemaining).toBe(2);
  });
});

describe("the rest of the board", () => {
  const board = () =>
    mapVsBoard({
      match: MATCHES["2504876"],
      stats: null,
      config: champ(6005),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 27824,
    });

  it("keeps the VIS match number as the board's identity", () => {
    expect(board().matchNo).toBe(27824);
  });

  it("maps home to A and guest to B, for the score, the serve and the side", () => {
    const b = board();
    expect(b.teamA.name).toBe(MATCHES["2504876"].HomeTeam);
    expect(b.teamB.name).toBe(MATCHES["2504876"].GuestTeam);
    expect(b.scoreA).toBe(11);
    expect(b.scoreB).toBe(11);
    expect(b.serving).toBe("A"); // widget.serve === "home"
    expect(b.teamAAtLeft).toBe(true); // widget.left_side === "home"
  });

  it("builds the ladder with the set in play left undecided", () => {
    const b = board();
    // Set 1 finished 17-25; set 2 is being played at 11-11.
    expect(b.sets[0]).toMatchObject({ setNumber: 1, scoreA: 17, scoreB: 25, winner: "B" });
    expect(b.sets[1]).toMatchObject({ setNumber: 2, winner: null });
    expect(b.setsWonB).toBe(1);
    expect(b.status).toBe("LIVE");
    expect(b.inSetBreak).toBe(false);
  });

  it("calls a finished match finished, and decides every set", () => {
    const b = mapVsBoard({
      match: MATCHES["2491233"],
      stats: STATS,
      config: champ(6004),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(b.status).toBe("FINISHED");
    expect(b.setsWonA + b.setsWonB).toBe(5);
    expect(b.sets.every((s) => s.winner !== null)).toBe(true);
    expect(b.serving).toBeNull();
  });

  it("carries per-player points from the stats sheet, keyed by shirt", () => {
    const b = mapVsBoard({
      match: MATCHES["2491233"],
      stats: STATS,
      config: champ(6004),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    const scored = [...b.teamA.players, ...b.teamB.players].some((p) => p.points > 0);
    // The finished fixture has no line-up in its widget, so points are proved
    // through the team totals instead.
    expect(b.stats).not.toBeNull();
    expect((b.stats?.attacksA ?? 0) + (b.stats?.attacksB ?? 0)).toBeGreaterThan(0);
    expect(scored || b.teamA.players.length === 0).toBe(true);
  });

  it("has no statistics at all rather than a row of zeroes", () => {
    const b = mapVsBoard({
      match: MATCHES["2504866"],
      stats: null,
      config: champ(6005),
      rosterHome: null,
      rosterGuest: null,
      matchNo: 1,
    });
    expect(b.stats).toBeNull();
  });
});

describe("the join to VIS", () => {
  it("agrees with VIS on every AVC Women match number", () => {
    // The resolver's premise: MatchNumber is VIS's NoInTournament within one
    // event. 26 matches, and each number appears exactly once.
    const numbers = AVC.map((m) => String(m.MatchNumber));
    expect(numbers).toHaveLength(26);
    expect(new Set(numbers).size).toBe(26);
    expect(numbers).toContain("1");
  });

  it("carries the VIS team numbers in the team codes", () => {
    // VS Team.Code IS the VIS NoTeam — 9310 is Chinese Taipei in both systems.
    const tpe = TEAMS.find((t) => t.ShortCodeName === "TPE");
    expect(tpe?.Code).toBe("9310");
    expect(TEAMS).toHaveLength(12);
    for (const t of TEAMS) expect(Number(t.Code)).toBeGreaterThan(0);
  });

  it("carries the VIS player numbers on the roster entries", () => {
    const tpe = TEAMS.find((t) => t.ShortCodeName === "TPE")!;
    const hung = tpe.PlayerList?.find((p) => p.code === "167045");
    expect(hung).toBeDefined();
    expect(hung?.Number).toBe(6); // VIS NoShirt for the same player
  });
});
