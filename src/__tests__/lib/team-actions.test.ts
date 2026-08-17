/**
 * Roster mutations (spec/29 F1 — spec/31 backlog item 1).
 *
 * The rule under test is the one spec/29 introduced and nothing covered: a
 * roster row is EITHER a playing spot or a bench official, and a bench
 * official occupies no playing spot. If that ever drifts, a coach acquires a
 * jersey number and walks straight into the scoresheet's player rows and the
 * lineup pickers — the exact failure the picker-hygiene work existed to
 * prevent, arriving from the other direction.
 *
 * Written at the ACTION level rather than against a private helper, because
 * the interesting part is what reaches the insert: the form says
 * `staffFunction=C1` and the row must come out with a null jersey and no
 * captain/libero flags, whatever else the form asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  /**
   * Results for successive `db.select()` calls, in order. These actions run a
   * short fixed sequence of probes (team exists → person not already rostered
   * → jersey free), and a single shared result cannot express "the team is
   * there but the jersey is free".
   */
  selectQueue: [] as unknown[][],
}));

vi.mock("@/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "innerJoin", "where", "limit", "orderBy"])
      c[k] = () => c;
    const rows = dbState.selectQueue.shift() ?? [];
    (c as { then: unknown }).then = (
      res: (v: unknown[]) => unknown,
      rej?: (e: unknown) => unknown,
    ) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const db = {
    select: () => chain(),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        dbState.inserts.push(v);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        dbState.updates.push(v);
        return { where: async () => [] };
      },
    }),
    delete: () => ({ where: async () => [] }),
  };
  return { db, dbTx: db };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/action-gate", () => ({ gateCompetition: vi.fn() }));
vi.mock("@/lib/people-actions", () => ({ resolvePickedPerson: vi.fn() }));

import { gateCompetition } from "@/lib/action-gate";
import { resolvePickedPerson } from "@/lib/people-actions";
import { createPlayer, updatePlayer } from "@/lib/team-actions";
import { OK } from "@/lib/action-state";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.inserts = [];
  dbState.updates = [];
  // Default probe sequence for createPlayer: team found, person free,
  // jersey free.
  dbState.selectQueue = [[{ id: "team1" }], [], []];
  vi.mocked(gateCompetition).mockResolvedValue({
    tenantId: "tnt1",
    tenantSlug: "lisbon",
    competitionId: "cmp1",
  } as never);
  vi.mocked(resolvePickedPerson).mockResolvedValue({
    id: "per1",
    name: "Ana Silva",
  } as never);
});

const add = (over: Record<string, string> = {}) =>
  createPlayer(OK, fd({ teamId: "team1", personName: "Ana Silva", ...over }));

describe("a playing spot", () => {
  it("keeps the jersey number and the captain/libero flags", async () => {
    await add({ jerseyNumber: "7", isCaptain: "on", isLibero: "on" });
    expect(dbState.inserts[0]).toMatchObject({
      jerseyNumber: 7,
      isCaptain: true,
      isLibero: true,
      role: "PLAYER",
      staffFunction: null,
    });
  });

  it("is the default when no function is chosen", async () => {
    // The select submits "" for Player; that must not become a staff row.
    await add({ jerseyNumber: "3", staffFunction: "" });
    expect(dbState.inserts[0]).toMatchObject({
      role: "PLAYER",
      staffFunction: null,
      jerseyNumber: 3,
    });
  });
});

describe("a bench official", () => {
  it("occupies no playing spot, whatever the form asked for", async () => {
    // The form can carry a number and both flags — a coach takes none of them.
    await add({
      jerseyNumber: "9",
      isCaptain: "on",
      isLibero: "on",
      staffFunction: "C1",
    });
    expect(dbState.inserts[0]).toMatchObject({
      role: "STAFF",
      staffFunction: "C1",
      jerseyNumber: null,
      isCaptain: false,
      isLibero: false,
    });
  });

  it("accepts every function code the scoresheet prints", async () => {
    for (const fn of ["C1", "A1", "A2", "A3", "D1", "T", "P"]) {
      dbState.inserts = [];
      dbState.selectQueue = [[{ id: "team1" }], [], []];
      await add({ staffFunction: fn });
      expect(dbState.inserts[0]).toMatchObject({
        role: "STAFF",
        staffFunction: fn,
      });
    }
  });

  it("refuses an unknown code rather than storing it", async () => {
    // A stale form or a hand-crafted POST must not write a code the sheet
    // cannot render — it falls back to an ordinary player row.
    await add({ staffFunction: "HEAD_COACH", jerseyNumber: "4" });
    expect(dbState.inserts[0]).toMatchObject({
      role: "PLAYER",
      staffFunction: null,
      jerseyNumber: 4,
    });
  });
});

describe("editing a row in place", () => {
  it("converts a player into a bench official, clearing the spot", async () => {
    dbState.selectQueue = [[{ id: "plyr1", teamId: "team1" }], []];
    await updatePlayer(
      OK,
      fd({
        playerId: "plyr1",
        jerseyNumber: "7",
        isCaptain: "on",
        staffFunction: "A1",
      }),
    );
    expect(dbState.updates[0]).toMatchObject({
      role: "STAFF",
      staffFunction: "A1",
      jerseyNumber: null,
      isCaptain: false,
      isLibero: false,
    });
  });

  it("converts a bench official back into a player", async () => {
    dbState.selectQueue = [[{ id: "plyr1", teamId: "team1" }], []];
    await updatePlayer(
      OK,
      fd({ playerId: "plyr1", jerseyNumber: "12", staffFunction: "" }),
    );
    expect(dbState.updates[0]).toMatchObject({
      role: "PLAYER",
      staffFunction: null,
      jerseyNumber: 12,
    });
  });

  it("refuses without a player id", async () => {
    dbState.selectQueue = [];
    const state = await updatePlayer(OK, fd({ jerseyNumber: "1" }));
    expect(state.error).toContain("Missing player");
    expect(dbState.updates).toEqual([]);
  });
});

describe("jersey numbers stay unique per team", () => {
  it("refuses a number already worn", async () => {
    dbState.selectQueue = [[{ id: "team1" }], [], [{ id: "other" }]];
    const state = await add({ jerseyNumber: "7" });
    expect(state.error).toContain("already used");
    expect(dbState.inserts).toEqual([]);
  });

  it("does not run the duplicate check for a bench official", async () => {
    // Staff carry no number, so a "7 is taken" refusal would block a coach for
    // a reason that cannot apply to them. The probe is queued as OCCUPIED to
    // prove the check is skipped rather than merely passing.
    dbState.selectQueue = [[{ id: "team1" }], [], [{ id: "other" }]];
    const state = await add({ jerseyNumber: "7", staffFunction: "C1" });
    expect(state.error).toBeNull();
    expect(dbState.inserts[0]).toMatchObject({ staffFunction: "C1" });
  });
});
