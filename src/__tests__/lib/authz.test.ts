/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed; the real query builder's generics add nothing to these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasRole } from "@/lib/authz";

// ── Mocks for the DB-backed guards ───────────────────────────────────────────
// authz wraps getCurrentUser/isGlobalAdmin in React cache(), which can memoise
// per module instance in plain node — so each test below resetModules + freshly
// imports @/lib/authz, and drives the mocks through this hoisted state.
const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  isGlobalAdmin: false,
  roleRows: [] as { role: string }[],
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const rowsFor = (name: string) =>
    name === "users"
      ? [{ isGlobalAdmin: state.isGlobalAdmin }]
      : name === "user_tenant_roles"
        ? state.roleRows
        : [];
  const chain = (rows: unknown[]): any => ({
    from: (t: any) => chain(rowsFor(getTableConfig(t).name)),
    where: () => chain(rows),
    limit: () => chain(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  });
  return { db: { select: () => chain([]) } };
});

// getClaims(), not getUser(): authz verifies the JWT locally off the JWKS rather
// than paying an Auth round trip per request (spec/24 §9.5 F5). Claims are the
// token's shape — `sub` for the id — so the mock mirrors that, not a User row.
vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: state.user
          ? { claims: { sub: state.user.id, email: state.user.email } }
          : null,
      }),
    },
  }),
}));

vi.mock("@/lib/tenant", () => ({
  getTenantBySlug: async () => ({
    id: "ten1",
    slug: "lisbon",
    name: "Lisbon League",
    subdomain: null,
    branding: {
      title: null,
      primaryColor: "#0066cc",
      secondaryColor: "#ffffff",
      logoUrl: null,
      fontFamily: null,
      courtColorOverrides: null,
    },
  }),
}));

// Sentinels: next/navigation's real notFound/redirect throw framework internals.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

/** Fresh @/lib/authz so React cache() memoisation can't leak between tests. */
async function freshAuthz() {
  vi.resetModules();
  return import("@/lib/authz");
}

beforeEach(() => {
  state.user = { id: "u1", email: "u1@x.test" };
  state.isGlobalAdmin = false;
  state.roleRows = [];
});

describe("hasRole (spec/14 §A1)", () => {
  it("TENANT_ADMIN is a superuser for any requirement", () => {
    expect(hasRole(["TENANT_ADMIN"], ["SCORER"])).toBe(true);
    expect(hasRole(["TENANT_ADMIN"], ["COMPETITION_ADMIN"])).toBe(true);
  });

  it("matches when the user holds one of the allowed roles", () => {
    expect(hasRole(["SCORER"], ["SCORER", "COMPETITION_ADMIN"])).toBe(true);
    expect(hasRole(["COMPETITION_ADMIN"], ["COMPETITION_ADMIN"])).toBe(true);
  });

  it("denies when the user has no overlapping role", () => {
    expect(hasRole(["SCORER"], ["COMPETITION_ADMIN"])).toBe(false);
    expect(hasRole([], ["SCORER"])).toBe(false);
  });
});

describe("getAuthContext global-admin synthesis (spec/23 §3)", () => {
  it("global admins get exactly [TENANT_ADMIN] with no membership row", async () => {
    state.isGlobalAdmin = true;
    state.roleRows = []; // no user_tenant_roles row anywhere
    const { getAuthContext } = await freshAuthz();
    const ctx = await getAuthContext("lisbon");
    expect(ctx?.roles).toEqual(["TENANT_ADMIN"]);
    expect(ctx?.user).toEqual({ id: "u1", email: "u1@x.test" });
  });

  it("non-global admins get their real membership rows", async () => {
    state.roleRows = [{ role: "SCORER" }, { role: "VIEWER" }];
    const { getAuthContext } = await freshAuthz();
    const ctx = await getAuthContext("lisbon");
    expect(ctx?.roles).toEqual(["SCORER", "VIEWER"]);
  });

  it("returns null without a session", async () => {
    state.user = null;
    const { getAuthContext } = await freshAuthz();
    expect(await getAuthContext("lisbon")).toBe(null);
  });
});

describe("requireGlobalAdmin (spec/23 §3.2)", () => {
  it("signed-in non-admin gets notFound (surface stays hidden)", async () => {
    const { requireGlobalAdmin } = await freshAuthz();
    await expect(requireGlobalAdmin("/admin")).rejects.toThrow("NOT_FOUND");
  });

  it("anonymous gets the login redirect with the destination encoded", async () => {
    state.user = null;
    const { requireGlobalAdmin } = await freshAuthz();
    await expect(requireGlobalAdmin("/admin?tab=users")).rejects.toThrow(
      "REDIRECT /login?redirectTo=%2Fadmin%3Ftab%3Dusers",
    );
  });

  it("anonymous without a destination goes to bare /login", async () => {
    state.user = null;
    const { requireGlobalAdmin } = await freshAuthz();
    await expect(requireGlobalAdmin()).rejects.toThrow("REDIRECT /login");
  });

  it("global admins pass and get the user back", async () => {
    state.isGlobalAdmin = true;
    const { requireGlobalAdmin } = await freshAuthz();
    await expect(requireGlobalAdmin("/admin")).resolves.toEqual({
      user: { id: "u1", email: "u1@x.test" },
    });
  });
});
