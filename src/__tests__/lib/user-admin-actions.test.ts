/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed; the real query builder's generics add nothing to these tests */
// Platform People console actions (spec/23 addendum): self-lockout guards,
// last-admin guard, role allowlist, and the honest partial-failure message
// when the Supabase Auth account outlives the app rows.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  /** Rows returned by db.select().from(<table>), keyed by pg table name. */
  rowsByTable: {} as Record<string, unknown[]>,
  /** Rows resolved by update(...).returning(). */
  updateReturning: [] as unknown[],
  updates: [] as { table: string; set: Record<string, unknown> }[],
  /** Table names db.delete() received, in call order. */
  deletes: [] as string[],
}));

// The service-role client throws without env — and must never be real here.
const authAdmin = vi.hoisted(() => ({ deleteUser: vi.fn() }));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const chain = (rows: unknown[]): any => ({
    from: () => chain(rows),
    where: () => chain(rows),
    limit: () => chain(rows),
    returning: () => Promise.resolve(dbState.updateReturning),
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  });
  return {
    db: {
      select: () => ({
        from: (t: unknown) => chain(dbState.rowsByTable[nameOf(t)] ?? []),
      }),
      update: (t: unknown) => ({
        set: (set: Record<string, unknown>) => {
          dbState.updates.push({ table: nameOf(t), set });
          return chain([]);
        },
      }),
      delete: (t: unknown) => {
        dbState.deletes.push(nameOf(t));
        return chain([]);
      },
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn, // @/lib/tenant wraps at import time
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireGlobalAdmin: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/access", () => ({ adminCount: vi.fn() }));
vi.mock("@/lib/tenant-admin", () => ({
  getTenantById: vi.fn(),
  hasLiveMatch: vi.fn(),
}));
// Provisioning has its own coverage — here it only needs to not run for real.
vi.mock("@/lib/user-provisioning", () => ({
  appOrigin: vi.fn(async () => "https://app.test"),
  provisionUserByEmail: vi.fn(),
  resetUserPassword: vi.fn(),
  sendPasswordSetupEmail: vi.fn(),
  setSingleRole: vi.fn(),
}));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: authAdmin } }),
  // These tests run as the production schema; the refusal itself is covered in
  // shared-auth-guard.test.ts.
  authWriteBlockedReason: () => null,
}));

import { requireGlobalAdmin } from "@/lib/authz";
import { adminCount } from "@/lib/access";
import { getTenantById } from "@/lib/tenant-admin";
import { provisionUserByEmail } from "@/lib/user-provisioning";
import {
  addPlatformUser,
  deleteUserAccount,
  grantTenantRole,
  revokeTenantRole,
  setGlobalAdminFlag,
} from "@/lib/user-admin-actions";
import { OK } from "@/lib/action-state";
import { ADD_MEMBER_INIT } from "@/lib/roles";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  dbState.rowsByTable = {};
  dbState.updateReturning = [];
  dbState.updates = [];
  dbState.deletes = [];
  // Every action authorizes as "me" — the self-guard tests key off this id.
  vi.mocked(requireGlobalAdmin).mockResolvedValue({
    user: { id: "me", email: "me@x" },
  });
  vi.mocked(adminCount).mockResolvedValue(2);
  vi.mocked(getTenantById).mockResolvedValue(null);
  authAdmin.deleteUser.mockResolvedValue({ error: null });
});

describe("setGlobalAdminFlag", () => {
  it("refuses to revoke your own global access", async () => {
    const state = await setGlobalAdminFlag(
      OK,
      fd({ userId: "me", enable: "false" }),
    );
    expect(state.error).toContain("can't revoke your own");
    expect(dbState.updates).toEqual([]);
  });

  it("grants the flag to someone else", async () => {
    dbState.updateReturning = [{ email: "other@x" }];
    const state = await setGlobalAdminFlag(
      OK,
      fd({ userId: "u2", enable: "true" }),
    );
    expect(state.error).toBeNull();
    expect(state.ok).toBe(true);
    expect(dbState.updates).toEqual([
      { table: "users", set: { isGlobalAdmin: true } },
    ]);
  });

  it("reports an unknown user (empty returning)", async () => {
    dbState.updateReturning = [];
    const state = await setGlobalAdminFlag(
      OK,
      fd({ userId: "ghost", enable: "true" }),
    );
    expect(state.error).toContain("Unknown user");
  });
});

describe("deleteUserAccount", () => {
  it("refuses to delete yourself, before touching anything", async () => {
    const state = await deleteUserAccount(OK, fd({ userId: "me" }));
    expect(state.error).toContain("own account");
    expect(dbState.deletes).toEqual([]);
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("surfaces an auth-deletion failure after removing the app rows", async () => {
    dbState.rowsByTable["users"] = [{ email: "gone@x" }];
    authAdmin.deleteUser.mockResolvedValue({
      error: { message: "auth backend down" },
    });
    const state = await deleteUserAccount(OK, fd({ userId: "u2" }));
    // Honest partial failure: app access is gone, the login still exists.
    expect(state.error).toContain("sign-in account");
    expect(state.error).toContain("auth backend down");
    // Memberships before the user row (FK order), both before the auth call.
    expect(dbState.deletes).toEqual(["user_tenant_roles", "users"]);
  });
});

describe("revokeTenantRole", () => {
  const args = () => fd({ userId: "u2", tenantId: "tnt1" });

  it("blocks removing a tenant's last admin", async () => {
    dbState.rowsByTable["user_tenant_roles"] = [{ id: "utr1" }]; // is an admin
    vi.mocked(adminCount).mockResolvedValue(1);
    const state = await revokeTenantRole(OK, args());
    expect(state.error).toContain("last admin");
    expect(dbState.deletes).toEqual([]);
  });

  it("revokes a non-admin membership", async () => {
    dbState.rowsByTable["user_tenant_roles"] = []; // not a TENANT_ADMIN row
    const state = await revokeTenantRole(OK, args());
    expect(state.error).toBeNull();
    expect(state.ok).toBe(true);
    expect(dbState.deletes).toEqual(["user_tenant_roles"]);
  });
});

describe("grantTenantRole", () => {
  it("rejects roles outside the assignable allowlist", async () => {
    const state = await grantTenantRole(
      OK,
      fd({ userId: "u2", tenantId: "tnt1", role: "SUPERUSER" }),
    );
    expect(state.error).toContain("Choose a role.");
  });

  it("rejects an unknown tenant", async () => {
    const state = await grantTenantRole(
      OK,
      fd({ userId: "u2", tenantId: "ghost", role: "SCORER" }),
    );
    expect(state.error).toContain("Unknown tenant");
  });
});

describe("addPlatformUser", () => {
  it("rejects an invalid email before provisioning anything", async () => {
    const state = await addPlatformUser(ADD_MEMBER_INIT, fd({ email: "nope" }));
    expect(state.error).toContain("valid email");
    expect(vi.mocked(provisionUserByEmail)).not.toHaveBeenCalled();
  });

  it("requires a tenant for tenant-scoped access", async () => {
    const state = await addPlatformUser(
      ADD_MEMBER_INIT,
      fd({ email: "a@b.c", access: "tenant", role: "SCORER" }),
    );
    expect(state.error).toContain("Pick a tenant");
    expect(vi.mocked(provisionUserByEmail)).not.toHaveBeenCalled();
  });
});
