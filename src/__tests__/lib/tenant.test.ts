/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed; the real query builder's generics add nothing to these tests */
// Membership/roster read-model tests: row-collapsing logic behind the tenant
// switcher (getUserTenants), the Access page (listMembers) and the platform
// People console (listAllUsers). The drizzle chain is mocked; rows are keyed
// on the table passed to from(), so multi-query functions get distinct data.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantTitle, getUserTenants } from "@/lib/tenant";
import { listMembers } from "@/lib/access";
import { listAllUsers } from "@/lib/user-admin";

// Hoisted so the vi.mock factory (which is hoisted above imports) can see it.
const dbState = vi.hoisted(() => ({
  rowsByTable: {} as Record<string, unknown[]>,
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  // Thenable builder: every step returns the chain, awaiting yields the rows
  // registered for the from() table.
  const chain = (rows: unknown[]): any => ({
    from: (t: any) => chain(dbState.rowsByTable[getTableConfig(t).name] ?? rows),
    where: () => chain(rows),
    leftJoin: () => chain(rows),
    innerJoin: () => chain(rows),
    orderBy: () => chain(rows),
    limit: () => chain(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  });
  return { db: { select: () => chain([]) } };
});

beforeEach(() => {
  dbState.rowsByTable = {};
});

describe("tenantTitle (spec/23 §5.1)", () => {
  it("branding title wins over the tenant name", () => {
    expect(
      tenantTitle({ name: "Lisbon League", branding: { title: "Liga Lisboa" } }),
    ).toBe("Liga Lisboa");
  });

  it("falls back to the tenant name when branding has no title", () => {
    expect(tenantTitle({ name: "Lisbon League", branding: { title: null } })).toBe(
      "Lisbon League",
    );
  });
});

describe("getUserTenants (spec/23 §4)", () => {
  it("collapses multiple role rows for one tenant into a single entry", async () => {
    const base = {
      id: "ten1",
      slug: "lisbon",
      name: "Lisbon League",
      subdomain: "lisbon",
      title: null,
      logoUrl: null,
    };
    dbState.rowsByTable.user_tenant_roles = [
      { ...base, role: "TENANT_ADMIN" },
      { ...base, role: "SCORER" },
      // A second tenant stays its own entry.
      { ...base, id: "ten2", slug: "porto", name: "Porto", role: "VIEWER" },
    ];

    const tenants = await getUserTenants("user1");
    expect(tenants).toHaveLength(2);
    expect(tenants[0]).toMatchObject({ id: "ten1", slug: "lisbon" });
    expect(tenants[0].roles).toEqual(["TENANT_ADMIN", "SCORER"]);
    expect(tenants[1]).toMatchObject({ id: "ten2", roles: ["VIEWER"] });
  });
});

describe("listMembers (spec/23 addendum)", () => {
  it("collapses to the highest role per user and sorts by email", async () => {
    dbState.rowsByTable.user_tenant_roles = [
      // zoe holds two rows — TENANT_ADMIN outranks SCORER regardless of order.
      { userId: "u1", role: "SCORER", email: "zoe@x.test", name: "Zoe" },
      { userId: "u1", role: "TENANT_ADMIN", email: "zoe@x.test", name: "Zoe" },
      { userId: "u2", role: "VIEWER", email: "ana@x.test", name: null },
    ];

    const members = await listMembers("ten1");
    expect(members).toEqual([
      { userId: "u2", email: "ana@x.test", name: null, role: "VIEWER" },
      { userId: "u1", email: "zoe@x.test", name: "Zoe", role: "TENANT_ADMIN" },
    ]);
  });

  it("keeps the higher role when the stronger row comes first", async () => {
    dbState.rowsByTable.user_tenant_roles = [
      { userId: "u1", role: "COMPETITION_ADMIN", email: "a@x.test", name: null },
      { userId: "u1", role: "SCORER", email: "a@x.test", name: null },
    ];
    expect((await listMembers("ten1"))[0].role).toBe("COMPETITION_ADMIN");
  });
});

describe("listAllUsers (platform People console)", () => {
  it("groups memberships under the right user; membership-less users get []", async () => {
    const created = new Date("2026-07-01T00:00:00Z");
    dbState.rowsByTable.users = [
      { id: "u1", email: "a@x.test", name: "A", isGlobalAdmin: false, createdAt: created },
      { id: "u2", email: "b@x.test", name: null, isGlobalAdmin: true, createdAt: created },
    ];
    dbState.rowsByTable.user_tenant_roles = [
      { userId: "u1", role: "SCORER", tenantId: "t1", tenantName: "Lisbon", tenantSlug: "lisbon" },
      { userId: "u1", role: "TENANT_ADMIN", tenantId: "t2", tenantName: "Porto", tenantSlug: "porto" },
      // Orphan membership (user row missing) must not throw or leak anywhere.
      { userId: "ghost", role: "VIEWER", tenantId: "t1", tenantName: "Lisbon", tenantSlug: "lisbon" },
    ];

    const users = await listAllUsers();
    expect(users.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(users[0].memberships).toEqual([
      { tenantId: "t1", tenantName: "Lisbon", tenantSlug: "lisbon", role: "SCORER" },
      { tenantId: "t2", tenantName: "Porto", tenantSlug: "porto", role: "TENANT_ADMIN" },
    ]);
    expect(users[1].memberships).toEqual([]);
  });
});
