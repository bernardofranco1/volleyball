/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle mock chains are deliberately loosely typed, as in the sibling admin-action tests */
// The other half of spec/26: the authz overlay. The cookie's crypto is real
// here (only the cookie JAR is mocked), so these tests pin the security
// contract end-to-end — a valid signature is never enough on its own.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Supabase claims for the REAL session. */
  claims: null as { sub: string; email?: string } | null,
  /** Raw vbimp cookie value. */
  cookie: null as string | null,
  /** is_global_admin by user id — the flag lookup is keyed like the real one. */
  globalAdmins: {} as Record<string, boolean>,
  /** users row returned for the impersonation-target lookup. */
  targetRow: undefined as
    | { id: string; email: string; isGlobalAdmin: boolean }
    | undefined,
  /** user_tenant_roles rows for rolesFor(). */
  roleRows: [] as { role: string }[],
  /** Tenant returned by getTenantBySlug. */
  tenant: null as { id: string; slug: string; name: string } | null,
}));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  /** Pull bound parameter values out of a drizzle where-clause. */
  const paramsOf = (clause: any): unknown[] => {
    const out: unknown[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if ("value" in n && (typeof n.value === "string" || typeof n.value === "number"))
        out.push(n.value);
      for (const k of ["queryChunks", "chunks"])
        if (Array.isArray(n[k])) n[k].forEach(walk);
    };
    walk(clause);
    return out;
  };
  const chain = (resolve: (params: unknown[]) => unknown[], params: unknown[] = []): any => ({
    from: () => chain(resolve, params),
    where: (clause: unknown) => chain(resolve, [...params, ...paramsOf(clause)]),
    limit: () => chain(resolve, params),
    then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(params)).then(res, rej),
  });
  return {
    db: {
      // The two users lookups are told apart by their projection: the flag
      // check selects only isGlobalAdmin, the target lookup also selects email.
      // The flag check is answered PER USER ID, exactly like the real query —
      // that is what makes the no-escalation test meaningful.
      select: (projection?: Record<string, unknown>) => ({
        from: (t: unknown) => {
          const table = nameOf(t);
          if (table === "users") {
            const wantsEmail = !!projection && "email" in projection;
            if (wantsEmail)
              return chain(() => (state.targetRow ? [state.targetRow] : []));
            return chain((params) => {
              const id = params.find((p) => typeof p === "string") as string | undefined;
              if (id === undefined || !(id in state.globalAdmins)) return [];
              return [{ isGlobalAdmin: state.globalAdmins[id] }];
            });
          }
          if (table === "user_tenant_roles") return chain(() => state.roleRows);
          return chain(() => []);
        },
      }),
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }) },
  }),
}));

// Real crypto, mocked jar.
vi.mock("@/lib/impersonation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentImpersonationCookie: async () => state.cookie,
}));

vi.mock("@/lib/tenant", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTenantBySlug: async () => state.tenant,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

const ADMIN = { sub: "usr_admin", email: "admin@platform.test" };
const TARGET = { id: "usr_target", email: "scorer@club.test", isGlobalAdmin: false };

/** Fresh module graph per case so React `cache()` never leaks between tests. */
async function load() {
  vi.resetModules();
  process.env.PIN_HMAC_SECRET ??= "test-secret-for-impersonation";
  const authz = await import("@/lib/authz");
  const { makeImpersonationCookie } = await import("@/lib/impersonation");
  return { ...authz, makeImpersonationCookie };
}

beforeEach(() => {
  state.claims = ADMIN;
  state.cookie = null;
  state.globalAdmins = { [ADMIN.sub]: true, [TARGET.id]: false };
  state.targetRow = TARGET;
  state.roleRows = [];
  state.tenant = { id: "tnt_1", slug: "club", name: "Club" };
});

describe("impersonation overlay (spec/26 §5)", () => {
  it("without a cookie, the current user is the real user", async () => {
    const { getCurrentUser, getImpersonation } = await load();
    expect(await getImpersonation()).toBeNull();
    expect((await getCurrentUser())?.id).toBe(ADMIN.sub);
  });

  it("with a valid cookie, the current user becomes the target", async () => {
    const { getCurrentUser, getRealUser, getImpersonation, makeImpersonationCookie } =
      await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;

    expect((await getCurrentUser())?.id).toBe(TARGET.id);
    expect((await getCurrentUser())?.email).toBe(TARGET.email);
    // The real session is still there underneath — that's what the banner and
    // the exit action authenticate against.
    expect((await getRealUser())?.id).toBe(ADMIN.sub);
    const imp = await getImpersonation();
    expect(imp?.actor.id).toBe(ADMIN.sub);
    expect(imp?.target.id).toBe(TARGET.id);
  });

  it("attribution stays with the real admin while impersonating", async () => {
    const { getAttributionUser, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    expect((await getAttributionUser())?.id).toBe(ADMIN.sub);
  });

  it("ignores the cookie when the actor is no longer a global admin", async () => {
    const { getCurrentUser, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    state.globalAdmins[ADMIN.sub] = false; // flag revoked mid-session
    expect((await getCurrentUser())?.id).toBe(ADMIN.sub);
  });

  it("ignores the cookie when the session belongs to someone else", async () => {
    const { getCurrentUser, makeImpersonationCookie } = await load();
    // Cookie minted for a different admin, replayed into this session.
    state.cookie = makeImpersonationCookie("usr_other_admin", TARGET.id).value;
    expect((await getCurrentUser())?.id).toBe(ADMIN.sub);
  });

  it("ignores the cookie when there is no session at all", async () => {
    const { getCurrentUser, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    state.claims = null;
    expect(await getCurrentUser()).toBeNull();
  });

  it("refuses a target that has become a global admin", async () => {
    const { getCurrentUser, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    state.targetRow = { ...TARGET, isGlobalAdmin: true };
    expect((await getCurrentUser())?.id).toBe(ADMIN.sub);
  });

  it("refuses a target that no longer exists", async () => {
    const { getCurrentUser, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    state.targetRow = undefined;
    expect((await getCurrentUser())?.id).toBe(ADMIN.sub);
  });

  it("does NOT synthesise TENANT_ADMIN for the target (no escalation)", async () => {
    // The load-bearing detail: rolesFor short-circuits to ["TENANT_ADMIN"] for
    // global admins. While impersonating, that lookup must be keyed by the
    // TARGET — otherwise every gate would stay wide open behind the overlay.
    const { getAuthContext, makeImpersonationCookie } = await load();
    state.cookie = makeImpersonationCookie(ADMIN.sub, TARGET.id).value;
    state.roleRows = [{ role: "SCORER" }];

    const ctx = await getAuthContext("club");
    expect(ctx?.user.id).toBe(TARGET.id);
    expect(ctx?.roles).toEqual(["SCORER"]);
    expect(ctx?.roles).not.toContain("TENANT_ADMIN");
    expect(ctx?.actor?.id).toBe(ADMIN.sub);
  });

  it("the real admin keeps TENANT_ADMIN everywhere when not impersonating", async () => {
    const { getAuthContext } = await load();
    state.roleRows = [];
    const ctx = await getAuthContext("club");
    expect(ctx?.user.id).toBe(ADMIN.sub);
    expect(ctx?.roles).toEqual(["TENANT_ADMIN"]);
    expect(ctx?.actor).toBeNull();
  });
});
