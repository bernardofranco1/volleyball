/**
 * Source selection in the store (spec/45 §6bis).
 *
 * The property that matters most here is the one an event depends on: choosing
 * VolleyStation must never be able to COST a board. Every way VS can fail —
 * unmapped, unconfigured, erroring, timing out — has to end with the same
 * screen served from VIS, in the same request.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbRows = vi.hoisted(() => ({ competitions: [] as Record<string, unknown>[] }));

vi.mock("@/db", () => {
  const db = {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    select: () => ({ from: () => ({ where: async () => dbRows.competitions }) }),
  };
  return { db, dbTx: db, DB_SCHEMA: "public", IS_PROD_SCHEMA: true };
});

import { getBoard, __resetVisCaches } from "@/lib/vis-live/store";
import { VS_IN_RALLY_MS, LIVE_MS } from "@/lib/vis-live/cadence";
import { __resetVsResolve, ensureMapping } from "@/lib/vs-live/resolve";
import { __resetVsClientCaches } from "@/lib/vs-live/client";
import { __resetLineupStability } from "@/lib/vis-live/lineup-stability";

const VIS_XML = readFileSync(
  new URL("../fixtures/vis/volley-live-events-27550.xml", import.meta.url),
  "utf-8",
).replace(/\sEndDateTime="[^"]*"/, "");

const VS_MATCHES = JSON.parse(
  readFileSync(new URL("../fixtures/vs/matches.json", import.meta.url), "utf-8"),
) as Record<string, unknown>;
const VS_CHAMPS = readFileSync(
  new URL("../fixtures/vs/championships.json", import.meta.url),
  "utf-8",
);
const VS_TEAMS = readFileSync(
  new URL("../fixtures/vs/teams-6181.json", import.meta.url),
  "utf-8",
);

/**
 * The VIS match LIST, which is what the resolver joins against — and which
 * carries the team codes the verification belt needs. Match #4 of tournament
 * 1766 is VIS 27550, Qatar v Venezuela.
 */
const VIS_LIST_XML =
  '<?xml version="1.0" encoding="utf-8"?><Responses><VolleyballMatches>' +
  '<VolleyballMatch No="27550" NoInTournament="4" TeamACode="TPE" TeamBCode="IRI" ' +
  'TeamAName="Chinese Taipei" TeamBName="Iran" DateLocal="2026-08-21" Status="1"/>' +
  "</VolleyballMatches></Responses>";

/** VIS answers XML on fivb.org; VolleyStation answers JSON on panel.*. */
function stubBoth(opts: { vsFails?: boolean } = {}) {
  const seen: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("fivb.org")) {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return new Response(
        body.includes("GetVolleyMatchList") ? VIS_LIST_XML : VIS_XML,
        { status: 200 },
      );
    }
    if (opts.vsFails) return new Response("upstream is unwell", { status: 502 });
    if (u.includes("/Championships/")) return new Response(VS_CHAMPS, { status: 200 });
    if (/\/Matches\/\d+\//.test(u)) {
      return new Response(JSON.stringify(VS_MATCHES["2504876"]), { status: 200 });
    }
    if (u.includes("/Matches/?")) {
      // One VS match whose number AND teams match the VIS list row above.
      return new Response(
        JSON.stringify([
          {
            ChampionshipMatch_ID: 999,
            Championship_ID: 6181,
            MatchNumber: "4",
            HomeTeam: "Chinese Taipei",
            GuestTeam: "Iran",
            // Real ids from the committed AVC roster fixture, so the team-code
            // belt resolves them the way it does in production.
            HomeTeam_ID: 2248114,
            GuestTeam_ID: 2248115,
          },
        ]),
        { status: 200 },
      );
    }
    if (/\/Teams\/\d+\//.test(u)) {
      const id = Number(/\/Teams\/(\d+)\//.exec(u)![1]);
      const team = (JSON.parse(VS_TEAMS) as { Team_ID: number }[]).find(
        (t) => t.Team_ID === id,
      );
      return new Response(JSON.stringify(team ?? {}), { status: 200 });
    }
    if (u.includes("/MatchStatsSheet/")) return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  });
  return { seen };
}

/** The VIS list route is what the resolver joins against. */
function competitionRow(boardSource: string) {
  return [
    {
      id: "comp1",
      name: "AVC",
      visTournamentNo: 1766,
      vsChampionshipId: 6181,
      boardSource,
    },
  ];
}

beforeEach(() => {
  __resetVisCaches();
  __resetVsResolve();
  __resetVsClientCaches();
  __resetLineupStability();
  vi.stubEnv("VIS_APP_ID", "test-app-id");
  vi.stubEnv("VOLLEYSTATION_KEY", "test-key");
  dbRows.competitions = [];
});

describe("choosing a source", () => {
  it("serves VIS when a competition has no VolleyStation mapping", async () => {
    dbRows.competitions = [];
    const { seen } = stubBoth();
    const board = await getBoard(27550);
    expect(board.source).toBe("vis");
    expect(seen.some((u) => u.includes("panel.volleystation.com"))).toBe(false);
  });

  it("serves VolleyStation on a bare link when the competition says so", async () => {
    // The parameterless URL is what a venue TV runs. `board_source = vs` must
    // be enough to make VolleyStation the official source — no query string.
    dbRows.competitions = competitionRow("vs");
    stubBoth();
    await ensureMapping();
    const board = await getBoard(27550);
    expect(board.source).toBe("vs");
  });

  it("reads the setting fresh, so a revert does not wait on the mapping cache", async () => {
    // The setting is the emergency lever. It is read from the linked-competition
    // list (cached a minute), NOT from the mapping (cached ten) — otherwise
    // "put every screen back on VIS" would take ten minutes to obey.
    dbRows.competitions = competitionRow("vs");
    stubBoth();
    await ensureMapping();
    expect((await getBoard(27550)).source).toBe("vs");

    // Flip it the way the script does, and expire only the links cache.
    dbRows.competitions = competitionRow("vis");
    __resetVsResolve();
    stubBoth();
    await ensureMapping();
    expect((await getBoard(27550)).source).toBe("vis");
  });

  it("serves VIS when the competition says vis, even though it is mapped", async () => {
    dbRows.competitions = competitionRow("vis");
    const { seen } = stubBoth();
    const board = await getBoard(27550);
    expect(board.source).toBe("vis");
    expect(seen.some((u) => u.includes("/Matches/999/"))).toBe(false);
  });

  it("serves VolleyStation when a screen asks for it, whatever the default", async () => {
    dbRows.competitions = competitionRow("vis");
    stubBoth();
    await ensureMapping();
    const board = await getBoard(27550, Date.now(), "vs");
    expect(board.source).toBe("vs");
    // The fixture is a real VS payload: Brazil v Belgium, 11-11 in set two.
    expect(board.value.scoreA).toBe(11);
    expect(board.value.currentSet).toBe(2);
  });

  it("serves VIS when a screen asks for it, whatever the default", async () => {
    dbRows.competitions = competitionRow("vs");
    const board = await getBoard(27550, Date.now(), "vis");
    expect(board.source).toBe("vis");
  });

  it("holds the same match from both sources at once", async () => {
    // The comparison rig: two screens, one match, two feeds, independent
    // caches. Neither read may evict or overwrite the other.
    dbRows.competitions = competitionRow("auto");
    stubBoth();
    await ensureMapping();
    const vs = await getBoard(27550, Date.now(), "vs");
    const vis = await getBoard(27550, Date.now(), "vis");
    expect(vs.source).toBe("vs");
    expect(vis.source).toBe("vis");
    expect(vs.value).not.toBe(vis.value);
    // ...and going back to the first one still gets the first one.
    const again = await getBoard(27550, Date.now(), "vs");
    expect(again.source).toBe("vs");
    expect(again.value).toBe(vs.value);
  });
});

describe("a cold instance", () => {
  it("builds its mapping and reaches VolleyStation on the first request", async () => {
    // Serverless instances are short-lived and numerous, so "the next request
    // will have the mapping" is usually a DIFFERENT instance starting cold —
    // a background-only refresh would mean VolleyStation was never reached at
    // all. The first request therefore waits for the build.
    dbRows.competitions = competitionRow("vs");
    stubBoth();
    const cold = await getBoard(27550);
    expect(cold.source).toBe("vs");
  });

  it("gives up on a hanging upstream and serves VIS instead", async () => {
    // ...but never waits longer than a board can afford. VolleyStation's Teams
    // list has been measured hanging for 30 s; a screen in a hall cannot.
    dbRows.competitions = competitionRow("vs");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("fivb.org")) {
        const body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(
          body.includes("GetVolleyMatchList") ? VIS_LIST_XML : VIS_XML,
          { status: 200 },
        );
      }
      // VolleyStation never answers.
      return new Promise<Response>(() => {});
    });
    const board = await getBoard(27550);
    expect(board.source).toBe("vis");
    expect(board.value.teamA.name).not.toBe("");
  }, 20_000);
});

describe("the cadence follows the rally", () => {
  /** The live fixture, with the widget saying a rally is or is not in flight. */
  function stubWithRally(inRally: boolean) {
    const base = JSON.parse(JSON.stringify(VS_MATCHES["2504876"])) as {
      widget: Record<string, unknown>;
    };
    base.widget.in_rally = inRally;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("fivb.org")) {
        const body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(
          body.includes("GetVolleyMatchList") ? VIS_LIST_XML : VIS_XML,
          { status: 200 },
        );
      }
      if (u.includes("/Championships/")) return new Response(VS_CHAMPS, { status: 200 });
      if (/\/Teams\/\d+\//.test(u)) {
        const id = Number(/\/Teams\/(\d+)\//.exec(u)![1]);
        const team = (JSON.parse(VS_TEAMS) as { Team_ID: number }[]).find(
          (t) => t.Team_ID === id,
        );
        return new Response(JSON.stringify(team ?? {}), { status: 200 });
      }
      if (/\/Matches\/\d+\//.test(u)) return new Response(JSON.stringify(base), { status: 200 });
      if (u.includes("/Matches/?")) {
        return new Response(
          JSON.stringify([
            {
              ChampionshipMatch_ID: 999,
              Championship_ID: 6181,
              MatchNumber: "4",
              HomeTeam: "Chinese Taipei",
              GuestTeam: "Iran",
              HomeTeam_ID: 2248114,
              GuestTeam_ID: 2248115,
            },
          ]),
          { status: 200 },
        );
      }
      if (u.includes("/MatchStatsSheet/")) return new Response("[]", { status: 200 });
      return new Response("{}", { status: 200 });
    });
  }

  it("asks more often while a rally is in progress", async () => {
    // VolleyStation says a point is imminent; that is the one moment the delay
    // between the feed and the hall is worth paying for.
    dbRows.competitions = competitionRow("vs");
    stubWithRally(true);
    await ensureMapping();
    const board = await getBoard(27550);
    expect(board.source).toBe("vs");
    expect(board.pollMs).toBe(VS_IN_RALLY_MS);
    expect(board.pollMs).toBeLessThan(LIVE_MS);
  });

  it("falls back to the ordinary live cadence between rallies", async () => {
    dbRows.competitions = competitionRow("vs");
    stubWithRally(false);
    await ensureMapping();
    const board = await getBoard(27550);
    expect(board.source).toBe("vs");
    expect(board.pollMs).toBe(LIVE_MS);
  });

  it("tells the browser the cadence the STORE used, not a recomputed guess", async () => {
    // The route forwards this straight to the poll timer. Recomputing the rule
    // from the board alone would lose the in-rally cadence entirely, because
    // `in_rally` never reaches the board view model.
    dbRows.competitions = competitionRow("vs");
    stubWithRally(true);
    await ensureMapping();
    const board = await getBoard(27550);
    expect(board.value.status).toBe("LIVE");
    expect(board.pollMs).not.toBe(LIVE_MS);
  });
});

describe("VolleyStation can never cost a board", () => {
  it("falls back to VIS in the same request when VolleyStation errors", async () => {
    dbRows.competitions = competitionRow("vs");
    stubBoth();
    await ensureMapping();
    // Now break VolleyStation, with the mapping already in hand.
    stubBoth({ vsFails: true });
    const board = await getBoard(27550);
    expect(board.source).toBe("vis");
    expect(board.value.teamA.name).not.toBe("");
  });

  it("falls back when this deployment has no VolleyStation key", async () => {
    dbRows.competitions = competitionRow("vs");
    vi.stubEnv("VOLLEYSTATION_KEY", "");
    stubBoth();
    const board = await getBoard(27550);
    expect(board.source).toBe("vis");
  });

  it("falls back when a screen forces vs on a match that is not mapped", async () => {
    dbRows.competitions = [];
    stubBoth();
    const board = await getBoard(27550, Date.now(), "vs");
    expect(board.source).toBe("vis");
  });
});
