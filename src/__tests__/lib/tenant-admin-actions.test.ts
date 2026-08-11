// Tenant lifecycle Server Actions (spec/23 §3.3): createTenant validation and
// unique-violation handling, softDeleteTenant's guard chain (backup MUST
// succeed before deleted_at is set), restoreTenant.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  /** Error to throw from db.transaction (unique-violation test). */
  transactionError: null as unknown,
  transactions: 0,
  /** db.update(<table>).set(...) calls, in order. */
  updates: [] as { table: string; set: Record<string, unknown> }[],
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      dbState.transactions += 1;
      if (dbState.transactionError) throw dbState.transactionError;
      await fn({ insert: () => ({ values: async () => {} }) });
    },
    update: (t: unknown) => ({
      set: (set: Record<string, unknown>) => {
        dbState.updates.push({ table: nameOf(t), set });
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  // Transactions run on the dedicated single-connection pool (src/db/index.ts),
  // so the mock must expose it too — `db` alone cannot begin a transaction.
  return { db, dbTx: db };
});

// next/cache & next/navigation throw outside a request — always mock in tests.
// unstable_cache is included because @/lib/tenant (pulled in via the real
// authz module below) wraps a function with it at import time.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tenant-admin", () => ({
  getTenantById: vi.fn(),
  hasLiveMatch: vi.fn(),
}));
vi.mock("@/lib/backup", async () => {
  // Keep the real policy constants (TEST_TENANT_SLUG etc.) — only the runtime
  // entry point is faked, so the Test-tenant guard is tested against the
  // actual slug, not a copy that could drift.
  const policy = await vi.importActual<object>("@/lib/backup-policy");
  return { ...policy, runBackup: vi.fn() };
});
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireGlobalAdmin: vi.fn(),
}));

import { updateTag } from "next/cache";
import { requireGlobalAdmin } from "@/lib/authz";
import { runBackup, TEST_TENANT_SLUG } from "@/lib/backup";
import { getTenantById, hasLiveMatch } from "@/lib/tenant-admin";
import { recordAudit } from "@/lib/audit";
import {
  createTenant,
  restoreTenant,
  softDeleteTenant,
} from "@/lib/tenant-admin-actions";
import { OK } from "@/lib/action-state";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** Minimal AdminTenantDetail — the actions only read id/slug/name/deletedAt. */
const tenant = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "tnt1",
    slug: "lisbon",
    name: "Lisbon League",
    subdomain: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    branding: {},
    ...over,
  }) as unknown as Awaited<ReturnType<typeof getTenantById>>;

beforeEach(() => {
  dbState.transactionError = null;
  dbState.transactions = 0;
  dbState.updates = [];
  vi.mocked(requireGlobalAdmin).mockResolvedValue({
    user: { id: "admin1", email: "admin@x" },
  });
  vi.mocked(getTenantById).mockResolvedValue(null);
  vi.mocked(hasLiveMatch).mockResolvedValue(false);
  vi.mocked(runBackup).mockResolvedValue({
    runId: "bkp_1",
    ok: true,
    objectPath: "tnt1/full/2026-07-30.json.gz",
    sizeBytes: 512,
  });
});

describe("createTenant validation", () => {
  // Everything valid except the field under test.
  const valid = { name: "Lisbon", slug: "lisbon" };

  it.each([
    [{ ...valid, name: "" }, "tenant name"],
    [{ ...valid, name: "a".repeat(81) }, "max 80"],
    [{ ...valid, slug: "-lead" }, "Slug must be"],
    [{ ...valid, slug: "a".repeat(51) }, "Slug must be"],
    [{ ...valid, subdomain: "admin" }, "Subdomain"], // reserved label
    [{ ...valid, subdomain: "-bad" }, "Subdomain"], // invalid label
    [{ ...valid, title: "t".repeat(61) }, "Title is too long"],
  ])("rejects %o with %s", async (fields, fragment) => {
    const state = await createTenant(OK, fd(fields));
    expect(state.error).toContain(fragment);
    // Guard order: nothing may be written when validation fails.
    expect(dbState.transactions).toBe(0);
  });

  it("maps a 23505 unique violation to a form error, not a throw", async () => {
    dbState.transactionError = { code: "23505" };
    const state = await createTenant(OK, fd(valid));
    expect(state.error).toContain("already taken");
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

describe("softDeleteTenant guards (in order)", () => {
  const goodFd = () => fd({ tenantId: "tnt1", confirmName: "Lisbon League" });

  it("rejects an unknown tenant", async () => {
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toContain("Unknown tenant");
  });

  it("rejects an already-deleted tenant", async () => {
    vi.mocked(getTenantById).mockResolvedValue(
      tenant({ deletedAt: new Date() }),
    );
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toContain("already deleted");
  });

  it("refuses to delete the Test tenant", async () => {
    vi.mocked(getTenantById).mockResolvedValue(
      tenant({ slug: TEST_TENANT_SLUG }),
    );
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toContain("cannot be deleted");
  });

  it("requires the exact tenant name as confirmation", async () => {
    vi.mocked(getTenantById).mockResolvedValue(tenant());
    const state = await softDeleteTenant(
      OK,
      fd({ tenantId: "tnt1", confirmName: "lisbon league" }),
    );
    expect(state.error).toContain("exact name");
    // Confirmation comes before the (more expensive) live-match check.
    expect(vi.mocked(hasLiveMatch)).not.toHaveBeenCalled();
  });

  it("blocks while a match is LIVE — before any backup runs", async () => {
    vi.mocked(getTenantById).mockResolvedValue(tenant());
    vi.mocked(hasLiveMatch).mockResolvedValue(true);
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toContain("LIVE");
    expect(vi.mocked(runBackup)).not.toHaveBeenCalled();
  });

  it("does NOT delete when the final backup fails", async () => {
    vi.mocked(getTenantById).mockResolvedValue(tenant());
    vi.mocked(runBackup).mockResolvedValue({
      runId: "bkp_1",
      ok: false,
      error: "boom",
    });
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toContain("NOT deleted");
    expect(state.error).toContain("boom");
    // The whole point of the guard: deleted_at must never be written.
    expect(dbState.updates).toEqual([]);
  });

  it("sets deleted_at once the final backup succeeded", async () => {
    vi.mocked(getTenantById).mockResolvedValue(tenant());
    const state = await softDeleteTenant(OK, goodFd());
    expect(state.error).toBeNull();
    expect(state.ok).toBe(true);
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].table).toBe("tenants");
    expect(dbState.updates[0].set.deletedAt).toBeInstanceOf(Date);
    expect(vi.mocked(recordAudit)).toHaveBeenCalled();
    // Cached tenant resolution must be invalidated or the site stays up.
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("tenant:lisbon");
  });
});

describe("restoreTenant", () => {
  it("fails when the tenant isn't deleted", async () => {
    vi.mocked(getTenantById).mockResolvedValue(tenant());
    const state = await restoreTenant(OK, fd({ tenantId: "tnt1" }));
    expect(state.error).toContain("isn't deleted");
    expect(dbState.updates).toEqual([]);
  });

  it("clears deleted_at during the grace period", async () => {
    vi.mocked(getTenantById).mockResolvedValue(
      tenant({ deletedAt: new Date("2026-07-28") }),
    );
    const state = await restoreTenant(OK, fd({ tenantId: "tnt1" }));
    expect(state.error).toBeNull();
    expect(state.ok).toBe(true);
    expect(dbState.updates).toEqual([
      { table: "tenants", set: { deletedAt: null } },
    ]);
  });
});
