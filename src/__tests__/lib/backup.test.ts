/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed; the real query builder's generics add nothing to these tests */
// Backup engine (spec/23 §7): object naming, incremental scoping, runBackup's
// never-throws failure contract, and the incremental debounce rules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Param, SQL } from "drizzle-orm";

const dbState = vi.hoisted(() => ({
  /** Rows returned by db.select().from(<table>), keyed by pg table name. */
  rowsByTable: {} as Record<string, unknown[]>,
  /** Tables whose select should reject (db-outage test). */
  rejectTables: new Set<string>(),
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  updates: [] as { table: string; set: Record<string, unknown> }[],
  /** Error thrown from update(...).where() — FAILED-marker outage test. */
  updateError: null as unknown,
  /** Last WHERE condition per table, for cutoff introspection. */
  lastWhere: {} as Record<string, unknown>,
}));

const storage = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: () => storage } }),
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const chain = (rows: unknown[], reject: boolean): any => ({
    from: () => chain(rows, reject),
    where: () => chain(rows, reject),
    limit: () => chain(rows, reject),
    orderBy: () => chain(rows, reject),
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      (reject ? Promise.reject(new Error("db down")) : Promise.resolve(rows)).then(
        res,
        rej,
      ),
  });
  return {
    db: {
      select: () => ({
        from: (t: unknown) => {
          const table = nameOf(t);
          const rows = dbState.rowsByTable[table] ?? [];
          const reject = dbState.rejectTables.has(table);
          return {
            ...chain(rows, reject),
            where: (cond: unknown) => {
              dbState.lastWhere[table] = cond;
              return chain(rows, reject);
            },
          };
        },
      }),
      insert: (t: unknown) => ({
        values: (values: Record<string, unknown>) => {
          dbState.inserts.push({ table: nameOf(t), values });
          return Promise.resolve([]);
        },
      }),
      update: (t: unknown) => ({
        set: (set: Record<string, unknown>) => {
          dbState.updates.push({ table: nameOf(t), set });
          return {
            where: () =>
              dbState.updateError
                ? Promise.reject(dbState.updateError)
                : Promise.resolve([]),
          };
        },
      }),
    },
  };
});

import {
  EXPORTED_TABLES,
  INCREMENTAL_DEBOUNCE_MS,
  TEST_TENANT_SLUG,
  objectPathFor,
} from "@/lib/backup-policy";
import {
  exportTenant,
  runBackup,
  scheduleIncrementalBackup,
} from "@/lib/backup";
import { captureError } from "@/lib/observability";

/** Bound values inside a drizzle condition (e.g. the debounce cutoff Date). */
function paramValues(cond: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (chunk: unknown): void => {
    if (chunk instanceof Param) out.push(chunk.value);
    else if (chunk instanceof SQL) chunk.queryChunks.forEach(walk);
  };
  walk(cond);
  return out;
}

const backupRan = () => dbState.inserts.some((i) => i.table === "backup_runs");

beforeEach(() => {
  dbState.rowsByTable = {};
  dbState.rejectTables = new Set();
  dbState.inserts = [];
  dbState.updates = [];
  dbState.updateError = null;
  dbState.lastWhere = {};
  storage.upload.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("objectPathFor", () => {
  const now = new Date("2026-03-05T10:20:30.123Z");

  it("names FULL objects by day (same-day re-runs overwrite)", () => {
    expect(objectPathFor("tnt1", "FULL", undefined, now)).toBe(
      "tnt1/full/2026-03-05.json.gz",
    );
  });

  it("names incrementals with a colon-free ms timestamp + competition", () => {
    const path = objectPathFor("tnt1", "INCREMENTAL", { competitionId: "cmp1" }, now);
    expect(path).toBe("tnt1/incremental/2026-03-05T10-20-30-123Z-cmp1.json.gz");
    expect(path).not.toContain(":"); // colons are not storage-key safe
  });

  it("falls back to 'unknown' without a scope", () => {
    expect(objectPathFor("tnt1", "INCREMENTAL", undefined, now)).toMatch(
      /-unknown\.json\.gz$/,
    );
  });
});

describe("exportTenant scoping", () => {
  beforeEach(() => {
    dbState.rowsByTable = {
      tenants: [{ id: "tnt1" }],
      competitions: [{ id: "cmp1" }],
      csv_imports: [{ id: "csv1" }],
      audit_log: [{ id: "aud1" }],
    };
  });

  it("a competition scope makes an INCREMENTAL without tenant-wide logs", async () => {
    const doc = await exportTenant("tnt1", { competitionId: "cmp1" });
    expect(doc.kind).toBe("INCREMENTAL");
    expect(doc.scope).toEqual({ competitionId: "cmp1" });
    // Tenant-wide logs are FULL-only — an incremental must not carry them.
    expect(doc.tables["csv_imports"]).toEqual([]);
    expect(doc.tables["audit_log"]).toEqual([]);
  });

  it("no scope makes a FULL with everything", async () => {
    const doc = await exportTenant("tnt1");
    expect(doc.kind).toBe("FULL");
    expect(doc.scope).toBeNull();
    expect(doc.tables["csv_imports"]).toEqual([{ id: "csv1" }]);
    expect(doc.tables["audit_log"]).toEqual([{ id: "aud1" }]);
  });

  it("the document's table set matches the policy's restore list", async () => {
    const doc = await exportTenant("tnt1");
    // The restore script walks EXPORTED_TABLES — a mismatch strands data.
    expect(Object.keys(doc.tables)).toEqual([...EXPORTED_TABLES]);
  });
});

describe("runBackup failure contract (never throws)", () => {
  const opts = { tenantId: "tnt1", kind: "FULL", trigger: "MANUAL" } as const;

  it("records OK with the payload size on success", async () => {
    const res = await runBackup(opts);
    expect(res.ok).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(dbState.inserts[0]).toMatchObject({
      table: "backup_runs",
      values: { status: "RUNNING" },
    });
    expect(dbState.updates.at(-1)).toMatchObject({
      table: "backup_runs",
      set: { status: "OK" },
    });
  });

  it("returns ok:false and marks the run FAILED when the upload fails", async () => {
    storage.upload.mockResolvedValue({ error: { message: "disk full" } });
    const res = await runBackup(opts);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("disk full");
    // Failures must be visible as a FAILED row, not silently absent.
    expect(dbState.updates.at(-1)).toMatchObject({
      table: "backup_runs",
      set: { status: "FAILED", error: expect.stringContaining("disk full") },
    });
    expect(vi.mocked(captureError)).toHaveBeenCalled();
  });

  it("still returns the original error when even the FAILED marker fails", async () => {
    storage.upload.mockResolvedValue({ error: { message: "disk full" } });
    dbState.updateError = new Error("db also down");
    const res = await runBackup(opts);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("disk full"); // no throw, no masking
  });
});

describe("scheduleIncrementalBackup debounce", () => {
  beforeEach(() => {
    dbState.rowsByTable["tenants"] = [{ slug: "club" }];
    dbState.rowsByTable["backup_runs"] = [];
  });

  it("does nothing for an unknown tenant", async () => {
    dbState.rowsByTable["tenants"] = [];
    await scheduleIncrementalBackup("ghost", "cmp1");
    expect(backupRan()).toBe(false);
  });

  it("skips the Test tenant (nightly reseed churn)", async () => {
    dbState.rowsByTable["tenants"] = [{ slug: TEST_TENANT_SLUG }];
    await scheduleIncrementalBackup("tnt1", "cmp1");
    expect(backupRan()).toBe(false);
  });

  it("suppresses a repeat for the same competition inside the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
    dbState.rowsByTable["backup_runs"] = [
      { id: "b1", status: "OK", scope: { competitionId: "cmp1" } },
    ];
    await scheduleIncrementalBackup("tnt1", "cmp1");
    expect(backupRan()).toBe(false);
    // The recency query must use exactly now - debounce as its floor.
    const cutoff = paramValues(dbState.lastWhere["backup_runs"]).find(
      (v): v is Date => v instanceof Date,
    );
    expect(cutoff?.getTime()).toBe(Date.now() - INCREMENTAL_DEBOUNCE_MS);
  });

  it("a recent FAILED run does not suppress the retry", async () => {
    dbState.rowsByTable["backup_runs"] = [
      { id: "b1", status: "FAILED", scope: { competitionId: "cmp1" } },
    ];
    await scheduleIncrementalBackup("tnt1", "cmp1");
    expect(backupRan()).toBe(true);
  });

  it("a recent run for a different competition does not suppress", async () => {
    dbState.rowsByTable["backup_runs"] = [
      { id: "b1", status: "OK", scope: { competitionId: "other" } },
    ];
    await scheduleIncrementalBackup("tnt1", "cmp1");
    expect(backupRan()).toBe(true);
  });

  it("swallows db errors (runs inside after() on scoring paths)", async () => {
    dbState.rejectTables.add("tenants");
    await expect(scheduleIncrementalBackup("tnt1", "cmp1")).resolves.toBeUndefined();
    expect(backupRan()).toBe(false);
    expect(vi.mocked(captureError)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: "backup-incremental" }),
    );
  });
});
