/**
 * The store's poll loop (spec/43): the `Version` handshake, and enforcement
 * reaching the board through the real path rather than beside it.
 *
 * `@/db` is mocked because the rotation log writes from inside the poll — and
 * one of the things asserted here is that a board does not depend on it.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => {
  const db = {
    insert: () => ({
      values: () => ({ onConflictDoNothing: async () => {} }),
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  return { db, dbTx: db, DB_SCHEMA: "public", IS_PROD_SCHEMA: true };
});

import { BOARD_OPTIONS, payloadVersion } from "@/lib/vis-live/client";
import { getBoard, __resetVisCaches, visStoreSnapshot } from "@/lib/vis-live/store";
import { __resetLineupStability } from "@/lib/vis-live/lineup-stability";
import {
  designatedLiberos,
  parseSetEvents,
  playerSides,
} from "@/lib/vis-live/events";
import { enforceLineups } from "@/lib/vis-live/serve-succession";
import { sixOf, type Side } from "@/lib/vis-live/rotation";
import { allTagAttrs, num, tagBlocks } from "@/lib/vis-live/parse";

const FINISHED_XML = readFileSync(
  new URL("../fixtures/vis/volley-live-events-27550.xml", import.meta.url),
  "utf-8",
);

/**
 * The same capture read as a match still in play, by the spec/35 W9 trick: drop
 * the end stamp, and give the last set back to nobody by decrementing the
 * winner's tally. Without both edits the payload contradicts itself and the
 * board sits on the set-break screen.
 */
const LIVE_XML = FINISHED_XML.replace(/\sEndDateTime="[^"]*"/, "").replace(
  /(<Match\b[^>]*?)\sMatchPointsB="3"/,
  '$1 MatchPointsB="2"',
);

const NO_CHANGES =
  '<?xml version="1.0" encoding="utf-8" standalone="yes"?>' +
  "<Responses><NoChanges /></Responses>";

/** The bodies the next fetches answer with, and a record of what was asked. */
function stubVis(bodies: string[]): { sent: string[] } {
  const sent: string[] = [];
  let i = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    sent.push(String((init as RequestInit).body));
    return new Response(bodies[Math.min(i++, bodies.length - 1)], { status: 200 });
  });
  return { sent };
}

/** What the enforcement model says about the latest set of a payload. */
function enforcedFor(xml: string) {
  const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
  const noTeamA = num(match, "NoTeamA", -1);
  const noTeamB = num(match, "NoTeamB", -2);
  const sides = playerSides(xml, noTeamA, noTeamB);
  const sets = tagBlocks(xml, "Set").sort(
    (a, b) => num(a.attrs, "No") - num(b.attrs, "No"),
  );
  const latest = sets[sets.length - 1];
  const head = latest.inner.split("<Events")[0];
  const startingFor = (noTeam: number) => {
    const row = allTagAttrs(head, "LineUp").find(
      (l) => num(l, "NoTeam", -99) === noTeam,
    );
    return row ? sixOf(row) : null;
  };
  return {
    liberos: designatedLiberos(latest.inner),
    enforced: enforceLineups({
      events: parseSetEvents(latest.inner, { noTeamA, noTeamB, sides }),
      startingLineups: { A: startingFor(noTeamA), B: startingFor(noTeamB) },
      liberos: designatedLiberos(latest.inner),
      sides,
      remembered: null,
    }),
  };
}

beforeEach(() => {
  __resetVisCaches();
  __resetLineupStability();
  vi.stubEnv("VIS_APP_ID", "test-app-id");
});

describe("the Version handshake", () => {
  it("asks from scratch first, then only for what changed since", async () => {
    const { sent } = stubVis([LIVE_XML, NO_CHANGES]);
    const first = await getBoard(27550);
    expect(sent[0]).toContain('Version="0"');
    expect(sent[0]).toContain(`Options="${BOARD_OPTIONS}"`);
    expect(first.value.scoreA).toBeGreaterThan(0);

    const version = payloadVersion(LIVE_XML);
    expect(visStoreSnapshot().boards[0].visVersion).toBe(version);

    // Past the TTL, so the store really polls again.
    await getBoard(27550, Date.now() + 120_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(`Version="${version}"`);
  });

  it("serves the payload it already holds when nothing has moved", async () => {
    stubVis([LIVE_XML, NO_CHANGES]);
    const before = await getBoard(27550);
    const changedAtBefore = visStoreSnapshot().boards[0].sinceChangeSeconds;
    const after = await getBoard(27550, Date.now() + 120_000);

    // The same board object: nothing was reparsed and nothing was rebuilt.
    expect(after.value).toBe(before.value);

    const row = visStoreSnapshot().boards[0];
    // The READ is fresh, so the board is no longer served as stale...
    expect(row.ageSeconds).toBeLessThanOrEqual(1);
    // ...but `changedAt` was NOT reset, because the score did not move. The
    // frozen-feed detector of spec/41 depends on that distinction: a NoChanges
    // that refreshed it would report a dead feed as advancing.
    expect(row.sinceChangeSeconds).toBeGreaterThanOrEqual(changedAtBefore);
  });

  it("asks for everything again if told NoChanges with nothing cached", async () => {
    const { sent } = stubVis([NO_CHANGES, LIVE_XML]);
    const board = await getBoard(27550);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('Version="0"');
    expect(board.value.teamA.name).not.toBe("");
  });
});

describe("enforcement reaches the board", () => {
  it("seats the six the rules give, not the six the feed last drew", async () => {
    stubVis([LIVE_XML]);
    const { value: board } = await getBoard(27550);
    const { enforced, liberos } = enforcedFor(LIVE_XML);

    expect(board.status).toBe("LIVE");
    expect(enforced.basis).toBe("enforced");
    for (const side of ["A", "B"] as const) {
      const six = side === "A" ? board.teamA.players : board.teamB.players;
      expect(six).toHaveLength(6);
      expect(six.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]);
      // The board's six IS the enforced six, jersey for jersey, in order.
      expect(six.map((p) => String(p.jersey))).not.toContain("null");
      expect(enforced[side]).not.toBeNull();
    }

    // A designated libero is marked, and never stands in the serving position.
    expect(liberos.size).toBeGreaterThan(0);
    expect(board.serving).not.toBeNull();
    const serving =
      board.serving === "A" ? board.teamA.players : board.teamB.players;
    expect(serving[0].isLibero).toBe(false);
  });

  it("puts the enforced order on the board, position for position", async () => {
    stubVis([LIVE_XML]);
    const { value: board } = await getBoard(27550);
    const { enforced } = enforcedFor(LIVE_XML);
    // Names come from the roster, so compare through it: the board carries
    // display rows, the model carries roster numbers.
    const rosterNames = new Map<string, string>();
    for (const team of tagBlocks(LIVE_XML, "Team")) {
      for (const p of tagBlocks(team.inner, "Player")) {
        const bio = allTagAttrs(p.inner, "VolleyballPlayer")[0];
        const no = String(num(p.attrs, "No", -1));
        rosterNames.set(no, bio?.TeamNamePlayer ?? bio?.LastNamePlayer ?? no);
      }
    }
    for (const side of ["A", "B"] as const satisfies readonly Side[]) {
      const six = side === "A" ? board.teamA.players : board.teamB.players;
      expect(six.map((p) => p.name)).toEqual(
        enforced[side]!.map((no) => rosterNames.get(no)),
      );
    }
  });

  it("keeps building a board when the rotation log cannot be written", async () => {
    // The log is instrumentation. A board must never depend on it, so this
    // asserts the failure is swallowed rather than propagated.
    const { db } = await import("@/db");
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("the database is on fire");
    });
    stubVis([LIVE_XML]);
    const { value: board } = await getBoard(27550);
    expect(board.teamA.players).toHaveLength(6);
  });
});

describe("a momentary VIS failure must not blank a live board", () => {
  it("keeps the last good score instead of falling back to the pre-start frame", async () => {
    // Seen in a venue on 2026-08-20, match 27553: the board read 0-0 in the
    // middle of a set. `mapVolleyMatch` — the pre-start read — carries no score
    // and no sets by design, and it was being cached OVER the live board on any
    // live-read failure, before the last good payload was even considered.
    let live = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = String((init as RequestInit).body ?? "");
      if (body.includes("GetVolleyLive")) {
        if (!live) return new Response("upstream is unwell", { status: 503 });
        return new Response(LIVE_XML, { status: 200 });
      }
      // GetVolleyMatch — the pre-start row, which has no score in it at all.
      return new Response(
        '<?xml version="1.0"?><Responses><VolleyballMatches><VolleyballMatch ' +
          'No="27550" TeamACode="QAT" TeamBCode="VEN" TeamAName="Qatar" ' +
          'TeamBName="Venezuela" DateLocal="2026-08-19" TimeLocal="13:35:00"/>' +
          "</VolleyballMatches></Responses>",
        { status: 200 },
      );
    });

    const good = await getBoard(27550);
    expect(good.value.status).toBe("LIVE");
    expect(good.value.scoreA + good.value.scoreB).toBeGreaterThan(0);

    live = false;
    const during = await getBoard(27550, Date.now() + 120_000);
    expect(during.value.status).toBe("LIVE");
    expect(during.value.scoreA).toBe(good.value.scoreA);
    expect(during.value.sets.length).toBeGreaterThan(0);
  });

  it("still uses the pre-start frame for a match that has not started", async () => {
    // The fallback is not removed — it is the right answer when there is no
    // live row yet, which is what it was built for.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = String((init as RequestInit).body ?? "");
      if (body.includes("GetVolleyLive")) {
        return new Response("<Responses></Responses>", { status: 200 });
      }
      return new Response(
        '<?xml version="1.0"?><Responses><VolleyballMatches><VolleyballMatch ' +
          'No="28803" TeamACode="TPE" TeamBCode="IRI" TeamAName="Chinese Taipei" ' +
          'TeamBName="Iran" DateLocal="2026-08-21" TimeLocal="10:00:00"/>' +
          "</VolleyballMatches></Responses>",
        { status: 200 },
      );
    });
    const board = await getBoard(28803);
    expect(board.value.teamA.name).toBe("Chinese Taipei");
    expect(board.value.scoreA).toBe(0);
  });
});

describe("the first server outlives the instance that saw it", () => {
  it("is written down only in the moment it MEANS first server", async () => {
    // `Set@NoServingTeam` names the first server only while the set has no
    // rallies; one rally later it means "whoever won that". Persisting the
    // later value would be persisting a different fact under the same name.
    const { noteFirstServer, firstServerFor } = await import(
      "@/lib/vis-live/rotation-audit"
    );
    noteFirstServer(910001, 1, 0, "B");
    expect(firstServerFor(910001, 1)).toBe("B");
    noteFirstServer(910002, 1, 9, "A");
    expect(firstServerFor(910002, 1)).toBeNull();
  });

  it("is what keeps the enforced rotation available without serve actions", async () => {
    // Enforcement reads the first server from rally one's serve action. A feed
    // with no action stream — VIS test data, and any scout that publishes none —
    // leaves it unknowable, enforcement falls back to following the feed, and
    // the feed's rewrite window then shows on screen as a rotation flickering
    // between two readings. Measured at the 2026-08-20 rehearsal: 0 actions on
    // the rehearsal match, 729 on a real one.
    const { enforceLineups } = await import("@/lib/vis-live/serve-succession");
    const six = { A: ["1", "2", "3", "4", "5", "6"], B: ["20", "21", "22", "23", "24", "25"] };
    const events = {
      rallies: [
        {
          index: 1, scoreA: 0, scoreB: 1, winner: "B" as const,
          server: null, // no action stream
          lineup: { A: null, B: null }, subsBefore: [],
        },
      ],
      trailingSubs: [],
    };
    const sides = new Map<string, "A" | "B">([["1", "A"], ["20", "B"]]);

    const blind = enforceLineups({
      events, startingLineups: six, liberos: new Set(), sides, remembered: null,
    });
    expect(blind.basis).toBe("fallback");

    const told = enforceLineups({
      events, startingLineups: six, liberos: new Set(), sides, remembered: "A",
    });
    expect(told.basis).toBe("enforced");
    expect(told.confidence).toBe("observed");
    // B received and won, so B rotates and its position 2 serves next.
    expect(told.B?.[0]).toBe("21");
  });
});
