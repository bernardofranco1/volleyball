/**
 * Roster CSV import (spec/24 §6.2, spec/25 §4 — spec/31 backlog item 1).
 *
 * `parseCsv` had tests; the IMPORT did not, and the import is what writes a
 * whole competition's rosters in one transaction. Its refusals are the
 * interesting part — each one is a way a bad file would otherwise become
 * permanent data:
 *
 *   - a duplicate jersey inside the file, or against a jersey already saved;
 *   - the same person on two teams in one competition (an eligibility rule,
 *     not untidiness);
 *   - rows with no team or no name;
 *   - the template's own example row, which must not import as a player.
 *
 * And the transaction shape: teams before people before players, because the
 * FKs run that way and a partial import would leave half-created teams behind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  /** Rows per table for `db.select().from(<table>)`. */
  rowsByTable: {} as Record<string, unknown[]>,
  /** Inserts captured inside the transaction, in order. */
  inserts: [] as { table: string; rows: unknown[] }[],
  /** Set to make the transaction throw (bulk-insert failure path). */
  transactionError: null as unknown,
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "innerJoin", "where", "limit", "orderBy"])
      c[k] = () => c;
    (c as { then: unknown }).then = (
      res: (v: unknown[]) => unknown,
      rej?: (e: unknown) => unknown,
    ) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const db = {
    select: () => ({
      from: (t: unknown) => chain(dbState.rowsByTable[nameOf(t)] ?? []),
    }),
    insert: () => ({ values: async () => {} }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      if (dbState.transactionError) throw dbState.transactionError;
      await fn({
        insert: (t: unknown) => ({
          values: async (rows: unknown[]) => {
            dbState.inserts.push({ table: nameOf(t), rows });
          },
        }),
      });
    },
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

import { gateCompetition } from "@/lib/action-gate";
import { importRoster } from "@/lib/csv-actions";
import { IMPORT_INIT } from "@/lib/action-state";

/** A FormData carrying a CSV file, as the upload form sends it. */
const csvForm = (body: string) => {
  const f = new FormData();
  f.set("file", new File([body], "roster.csv", { type: "text/csv" }));
  return f;
};

const HEADER = "Team,First name,Last name,Jersey,Captain,Libero";
const rows = (...lines: string[]) => [HEADER, ...lines].join("\n");

/** Players inserted by the last import. */
const inserted = () =>
  (dbState.inserts.find((i) => i.table === "players")?.rows ?? []) as Record<
    string,
    unknown
  >[];

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rowsByTable = {};
  dbState.inserts = [];
  dbState.transactionError = null;
  vi.mocked(gateCompetition).mockResolvedValue({
    tenantId: "tnt1",
    tenantSlug: "lisbon",
    competitionId: "cmp1",
    actor: { userId: "u1", email: "a@x" },
  } as never);
});

describe("a clean file", () => {
  it("creates the team, the people and the roster rows", async () => {
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,true,false", "Sporting,Rita,Costa,9,,")),
    );
    expect(state.error).toBeNull();
    expect(inserted()).toHaveLength(2);
    expect(inserted()[0]).toMatchObject({
      jerseyNumber: 7,
      isCaptain: true,
      isLibero: false,
    });
  });

  it("inserts teams before people before players — the FK order", async () => {
    await importRoster(IMPORT_INIT, csvForm(rows("Sporting,Ana,Silva,7,,")));
    const order = dbState.inserts.map((i) => i.table);
    expect(order.indexOf("teams")).toBeLessThan(order.indexOf("people"));
    expect(order.indexOf("people")).toBeLessThan(order.indexOf("players"));
  });

  it("reuses a team that already exists rather than duplicating it", async () => {
    dbState.rowsByTable.teams = [{ id: "team1", displayName: "Sporting" }];
    await importRoster(IMPORT_INIT, csvForm(rows("sporting,Ana,Silva,7,,")));
    // Matched case-insensitively, so no new team row.
    expect(dbState.inserts.find((i) => i.table === "teams")).toBeUndefined();
    expect(inserted()[0]).toMatchObject({ teamId: "team1" });
  });

  it("matches an existing person instead of creating a duplicate", async () => {
    dbState.rowsByTable.people = [
      {
        id: "per1",
        firstName: "Ana",
        lastName: "Silva",
        jerseyName: "Ana Silva",
        email: null,
        birthdate: null,
      },
    ];
    await importRoster(IMPORT_INIT, csvForm(rows("Sporting,Ana,Silva,7,,")));
    expect(dbState.inserts.find((i) => i.table === "people")).toBeUndefined();
    expect(inserted()[0]).toMatchObject({ personId: "per1" });
  });
});

describe("refusals that protect the roster", () => {
  it("refuses a jersey duplicated inside the file", async () => {
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,,", "Sporting,Rita,Costa,7,,")),
    );
    expect(state.summary?.messages.join(" ")).toContain("duplicate jersey 7");
    // The good row still imports — an import is not all-or-nothing per row.
    expect(inserted()).toHaveLength(1);
  });

  it("refuses a jersey already saved on that team", async () => {
    dbState.rowsByTable.teams = [{ id: "team1", displayName: "Sporting" }];
    dbState.rowsByTable.players = [
      { teamId: "team1", jerseyNumber: 7, personId: "perX" },
    ];
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,,")),
    );
    expect(state.summary?.messages.join(" ")).toContain("duplicate jersey 7");
    expect(inserted()).toHaveLength(0);
  });

  it("refuses the same person on two teams in one competition", async () => {
    // spec/25 §4: an eligibility rule. The DB stops a repeat on ONE team; two
    // teams in the same competition can only be caught here.
    dbState.rowsByTable.people = [
      {
        id: "per1",
        firstName: "Ana",
        lastName: "Silva",
        jerseyName: "Ana Silva",
        email: null,
        birthdate: null,
      },
    ];
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,,", "Benfica,Ana,Silva,4,,")),
    );
    expect(state.summary?.messages.join(" ")).toContain("already on a roster");
    expect(inserted()).toHaveLength(1);
  });

  it("names the offending row number, so a big file is fixable", async () => {
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,,", ",Rita,Costa,9,,")),
    );
    // Row 3 = second data row + header.
    expect(state.summary?.messages.join(" ")).toContain("Row 3");
    expect(state.summary?.messages.join(" ")).toContain("missing team");
  });

  it("refuses a row with no player name", async () => {
    const state = await importRoster(IMPORT_INIT, csvForm(rows("Sporting,,,7,,")));
    expect(state.summary?.messages.join(" ")).toContain("missing player name");
    expect(inserted()).toHaveLength(0);
  });

  it("refuses a file that is not a file", async () => {
    const state = await importRoster(IMPORT_INIT, new FormData());
    expect(state.error).toContain("Choose a CSV file");
  });

  it("reports a failed bulk insert instead of claiming success", async () => {
    dbState.transactionError = Object.assign(new Error("boom"), {
      constraint_name: "players_team_jersey_uq",
    });
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Sporting,Ana,Silva,7,,")),
    );
    expect(state.summary?.messages.join(" ")).toContain("Import failed");
    expect(state.summary?.ok).toBe(0);
  });
});

describe("the template's example row", () => {
  it("is skipped rather than imported as a player", async () => {
    // The downloadable template ships with a sample line; a user who fills in
    // the rows below it must not end up with a fictional player.
    const state = await importRoster(
      IMPORT_INIT,
      csvForm(rows("Example Team,Example,Player,1,,", "Sporting,Ana,Silva,7,,")),
    );
    expect(state.error).toBeNull();
    const names = inserted().length;
    expect(names).toBe(1);
  });
});
