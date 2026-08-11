/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed; the real query builder's generics add nothing to these tests */
// Tenant purge (spec/23 §3.4): hardDeleteTenant must cover every tenant-scoped
// table (rot-guard), delete children before FK parents, and purgeExpiredTenants
// must honour the grace window and stay best-effort per tenant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Param, SQL } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// Mock state must be hoistable — vi.mock factories run before file imports.
const dbState = vi.hoisted(() => ({
  /** Rows returned by db.select().from(<table>), keyed by pg table name. */
  rowsByTable: {} as Record<string, unknown[]>,
  /** Optional select filter so a test can emulate the WHERE clause. */
  selectWhere: null as
    | ((table: string, cond: unknown, rows: unknown[]) => unknown[])
    | null,
  /** Table names tx.delete() received, in call order. */
  deletes: [] as string[],
  /** How many db.transaction calls should reject (best-effort test). */
  failTransactions: 0,
  transactions: 0,
}));

vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

// Real @/db would open a socket on the first query — never in unit tests.
vi.mock("@/db", async () => {
  const { getTableConfig: cfg } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) => cfg(t as Parameters<typeof cfg>[0]).name;
  // Thenable builder chain: subqueries get built but never awaited; top-level
  // selects resolve to the seeded rows.
  const chain = (rows: unknown[]): any => ({
    from: () => chain(rows),
    where: () => chain(rows),
    limit: () => chain(rows),
    orderBy: () => chain(rows),
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  });
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const table = nameOf(t);
        const rows = dbState.rowsByTable[table] ?? [];
        return {
          ...chain(rows),
          where: (cond: unknown) =>
            chain(
              dbState.selectWhere
                ? dbState.selectWhere(table, cond, rows)
                : rows,
            ),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      dbState.transactions += 1;
      if (dbState.failTransactions > 0) {
        dbState.failTransactions -= 1;
        throw new Error("tx boom");
      }
      await fn({
        delete: (t: unknown) => {
          dbState.deletes.push(nameOf(t));
          return { where: () => Promise.resolve([]) };
        },
      });
    },
  };
  // Transactions run on the dedicated single-connection pool (src/db/index.ts),
  // so the mock must expose it too — `db` alone cannot begin a transaction.
  return { db, dbTx: db };
});

import {
  DELETE_GRACE_DAYS,
  hardDeleteTenant,
  purgeExpiredTenants,
} from "@/lib/tenant-admin";
import { captureError } from "@/lib/observability";

/** Bound values inside a drizzle condition (e.g. the purge cutoff Date). */
function paramValues(cond: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (chunk: unknown): void => {
    if (chunk instanceof Param) out.push(chunk.value);
    else if (chunk instanceof SQL) chunk.queryChunks.forEach(walk);
  };
  walk(cond);
  return out;
}

/** Schema-introspected set of tables hardDeleteTenant MUST wipe. */
function tenantScopedTables(): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue; // not a table export
    }
    // users are shared across tenants — the one deliberate exception.
    if (cfg.name === "users") continue;
    if (cfg.columns.some((c) => c.name === "tenant_id")) out.add(cfg.name);
  }
  return out;
}

beforeEach(() => {
  dbState.rowsByTable = {};
  dbState.selectWhere = null;
  dbState.deletes = [];
  dbState.failTransactions = 0;
  dbState.transactions = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hardDeleteTenant coverage (silent-purge-rot guard)", () => {
  it("deletes every schema table with a tenant_id column", async () => {
    await hardDeleteTenant("tnt_1");
    const deleted = new Set(dbState.deletes);
    // Introspection, not a hand-kept list: a new tenant-scoped table that
    // hardDeleteTenant forgets fails here instead of leaking rows forever.
    const missing = [...tenantScopedTables()].filter((t) => !deleted.has(t));
    expect(missing).toEqual([]);
  });

  it("also deletes the subtree tables without tenant_id and the tenants row", async () => {
    await hardDeleteTenant("tnt_1");
    const deleted = new Set(dbState.deletes);
    // These hang off competitions/pools via subqueries — no tenant_id column,
    // so the introspection above can't see them.
    for (const t of [
      "tournament_config",
      "competition_branding",
      "pool_teams",
      "tenants",
    ]) {
      expect(deleted).toContain(t);
    }
  });
});

describe("hardDeleteTenant FK order (children before parents)", () => {
  it("never deletes a parent before its children", async () => {
    await hardDeleteTenant("tnt_1");
    const order = dbState.deletes;
    const before = (child: string, parent: string) => {
      const c = order.indexOf(child);
      const p = order.indexOf(parent);
      expect(c, `${child} was never deleted`).toBeGreaterThanOrEqual(0);
      expect(p, `${parent} was never deleted`).toBeGreaterThanOrEqual(0);
      expect(c, `${child} must be deleted before ${parent}`).toBeLessThan(p);
    };
    before("events", "matches");
    before("matches", "teams");
    before("matches", "competitions");
    before("players", "teams");
    before("pool_teams", "pools");
    before("pool_teams", "teams");
    before("teams", "pools"); // teams.pool_id → pools
    before("teams", "competitions");
    before("tournament_config", "competitions");
    before("competition_branding", "competitions");
  });

  it("deletes the tenants row last", async () => {
    await hardDeleteTenant("tnt_1");
    expect(dbState.deletes.at(-1)).toBe("tenants");
  });
});

describe("purgeExpiredTenants", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("purges past the grace window only, with the exact cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
    const now = Date.now();
    dbState.rowsByTable["tenants"] = [
      {
        id: "t-old",
        slug: "old",
        deletedAt: new Date(now - (DELETE_GRACE_DAYS + 1) * DAY),
      },
      { id: "t-new", slug: "new", deletedAt: new Date(now - 1 * DAY) },
    ];
    // Emulate the WHERE: filter by the cutoff the query actually binds, so
    // this fails if the code stops applying the grace window in SQL.
    let cutoff: Date | undefined;
    dbState.selectWhere = (table, cond, rows) => {
      if (table !== "tenants") return rows;
      cutoff = paramValues(cond).find((v): v is Date => v instanceof Date);
      return (rows as { deletedAt: Date | null }[]).filter(
        (r) => r.deletedAt !== null && cutoff !== undefined && r.deletedAt < cutoff,
      );
    };

    const purged = await purgeExpiredTenants();
    expect(cutoff?.getTime()).toBe(now - DELETE_GRACE_DAYS * DAY);
    expect(purged).toEqual(["old"]);
    expect(dbState.transactions).toBe(1); // t-new was NOT hard-deleted
  });

  it("keeps purging after one tenant's hard delete fails (best-effort)", async () => {
    dbState.rowsByTable["tenants"] = [
      { id: "t-a", slug: "a" },
      { id: "t-b", slug: "b" },
    ];
    dbState.failTransactions = 1; // first hardDeleteTenant blows up

    const purged = await purgeExpiredTenants();
    expect(purged).toEqual(["b"]); // survivor only — no throw, no early exit
    expect(vi.mocked(captureError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureError)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: "tenant-purge", tenantId: "t-a" }),
    );
  });
});
