// Authorization helpers (Phase 3+, hardened per spec/14).
//
// The Proxy (src/proxy.ts) only does an optimistic "is there a session" check.
// Real authorization — which tenant, which role — is verified here, against the
// database, inside Server Components, Server Actions, and Route Handlers. Per the
// Next.js Data Security guidance, every mutation re-checks; never trust the proxy.
//
// Node-runtime only (queries the DB + reads the auth cookie).
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { matches, users, userTenantRoles } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  currentImpersonationCookie,
  readImpersonationCookie,
} from "@/lib/impersonation";
import { getTenantBySlug, type TenantWithBranding } from "@/lib/tenant";

export type Role = "TENANT_ADMIN" | "COMPETITION_ADMIN" | "SCORER" | "VIEWER";

/** The real signed-in admin behind an active "sign in as…" session (spec/26). */
export interface ImpersonationActor {
  id: string;
  email: string | null;
}

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: TenantWithBranding;
  roles: Role[];
  /**
   * Non-null only while impersonating: `user` is the target being tested,
   * `actor` is the global admin actually driving. Gates decide on `user`;
   * anything that RECORDS who did something must attribute to `actor` first
   * (spec/26 §8).
   */
  actor: ImpersonationActor | null;
}

/**
 * The authenticated user for this request, memoised so the layout, page, and any
 * nested guard share one verification (D / M3).
 *
 * `getClaims()` rather than `getUser()`: it verifies the access token locally
 * against the project's published ES256 JWKS instead of spending an Auth-server
 * round trip (20–80ms) on every scoring POST, every state resync and every page
 * render — the proxy already moved to it, authz.ts had not (spec/24 §9.5 F5).
 * On a project still using the legacy symmetric secret the SDK falls back to a
 * network check, so this is never *less* correct, only sometimes slower.
 *
 * Safe for revocation because a token is never the authority here: every gate
 * funnels through rolesFor(), a live DB read, and removing someone's access
 * deletes their user_tenant_roles rows (user-admin-actions.ts deleteUserAccount),
 * so a still-unexpired token resolves to zero roles and is refused.
 */
export const getRealUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    return {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    };
  },
);

/**
 * The active "sign in as…" overlay, or null (spec/26 §5).
 *
 * The cookie is NEVER sufficient on its own. Every request re-establishes:
 *   1. there is a real session, and it belongs to the cookie's actor;
 *   2. that actor is STILL a global admin (live DB read);
 *   3. the target still exists and is NOT a global admin.
 * Any failure — including a revoked flag or a deleted target — resolves to
 * null, i.e. the admin is simply themselves again. Memoised per request so the
 * layout, the page and every nested gate agree.
 */
export const getImpersonation = cache(
  async (): Promise<{
    target: { id: string; email: string | null };
    actor: ImpersonationActor;
    expiresAt: number;
  } | null> => {
    const claim = readImpersonationCookie(await currentImpersonationCookie());
    if (!claim) return null;

    const real = await getRealUser();
    if (!real || real.id !== claim.actorUserId) return null;
    if (!(await isGlobalAdmin(real.id))) return null;

    const target = (
      await db
        .select({
          id: users.id,
          email: users.email,
          isGlobalAdmin: users.isGlobalAdmin,
        })
        .from(users)
        .where(eq(users.id, claim.targetUserId))
        .limit(1)
    )[0];
    // Impersonating a global admin is refused at the door and re-refused here:
    // a target promoted mid-session must not carry the overlay into /admin.
    if (!target || target.isGlobalAdmin) return null;

    return {
      target: { id: target.id, email: target.email },
      actor: { id: real.id, email: real.email },
      expiresAt: claim.expiresAt,
    };
  },
);

/**
 * The EFFECTIVE user for this request: the impersonation target when a
 * "sign in as…" session is active, otherwise the real signed-in user.
 *
 * Every authorization gate resolves identity here, which is what makes the
 * overlay complete: requireRole, requireGlobalAdmin, authorizeMatch and
 * rolesFor all see the target and therefore behave exactly as they would for
 * that user — including refusing /admin.
 */
export const getCurrentUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const imp = await getImpersonation();
    if (imp) return imp.target;
    return getRealUser();
  },
);

/**
 * The user to ATTRIBUTE a write to: the real admin while impersonating, else
 * the current user (spec/26 §8).
 */
export async function getAttributionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const imp = await getImpersonation();
  return imp ? imp.actor : getCurrentUser();
}

/** Minimal shape shared by AuthContext and MatchAuth for attribution. */
type Attributable = { user: { id: string }; actor: ImpersonationActor | null };

/**
 * Whose id belongs in an identity column (`events.actor_user_id`,
 * `confirmed_by`, `captured_by`, `created_by`): the human actually driving.
 */
export function writerId(a: Attributable): string {
  return a.actor?.id ?? a.user.id;
}

/**
 * Human-readable provenance for the free-text `device_info` column: while
 * impersonating it records BOTH halves, so an auditor reading the event log
 * sees the admin and who they were testing as.
 */
export function writerNote(a: Attributable): string {
  return a.actor ? `${a.actor.id} (as ${a.user.id})` : a.user.id;
}

/** TENANT_ADMIN is a superuser within its tenant and satisfies any requirement. */
export function hasRole(roles: Role[], allowed: Role[]): boolean {
  if (roles.includes("TENANT_ADMIN")) return true;
  return roles.some((r) => allowed.includes(r));
}

/**
 * Platform superadmin flag (spec/23 §3). Memoised per request — every gate on
 * a page funnels through rolesFor, so without the cache a single render would
 * repeat the lookup. Not a membership: global admins never appear in
 * user_tenant_roles (the last-admin guard keeps counting real members only).
 */
export const isGlobalAdmin = cache(async (userId: string): Promise<boolean> => {
  const row = (
    await db
      .select({ isGlobalAdmin: users.isGlobalAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  return row?.isGlobalAdmin ?? false;
});

async function rolesFor(userId: string, tenantId: string): Promise<Role[]> {
  // A global admin is implicitly TENANT_ADMIN everywhere. Synthesising it here
  // means every existing gate (requireRole, authorizeMatch, gateCompetition)
  // honours the flag with no further changes.
  if (await isGlobalAdmin(userId)) return ["TENANT_ADMIN"];
  const rows = await db
    .select({ role: userTenantRoles.role })
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.tenantId, tenantId),
      ),
    );
  return rows.map((r) => r.role as Role);
}

/**
 * Gate for the /admin console (spec/23 §3.2): requires a session AND the
 * global-admin flag. Not-global-admin gets notFound() — same "don't reveal the
 * surface exists" convention as requireRole.
 */
export async function requireGlobalAdmin(redirectTo?: string): Promise<{
  user: { id: string; email: string | null };
}> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(
      redirectTo
        ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/login",
    );
  }
  if (!(await isGlobalAdmin(user.id))) notFound();
  return { user: { id: user.id, email: user.email ?? null } };
}

/**
 * Resolve the current user, the tenant for `slug`, and the user's roles in it.
 * Returns null when there is no authenticated user or the tenant doesn't exist.
 */
export async function getAuthContext(
  tenantSlug: string,
): Promise<AuthContext | null> {
  // The user check (Supabase Auth HTTP call) and the tenant lookup are
  // independent — run them concurrently.
  const [user, tenant, imp] = await Promise.all([
    getCurrentUser(),
    getTenantBySlug(tenantSlug),
    getImpersonation(),
  ]);
  if (!user) return null;
  if (!tenant) return null;
  return {
    user: { id: user.id, email: user.email ?? null },
    tenant,
    roles: await rolesFor(user.id, tenant.id),
    actor: imp?.actor ?? null,
  };
}

/**
 * Gate a page or Server Action on tenant membership + role.
 *   - no session        → redirect to /login (preserving destination)
 *   - unknown tenant     → notFound()
 *   - insufficient role  → notFound() (don't reveal the resource exists)
 */
export async function requireRole(
  tenantSlug: string,
  allowed: Role[],
  redirectTo?: string,
): Promise<AuthContext> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(
      redirectTo
        ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/login",
    );
  }
  const ctx = await getAuthContext(tenantSlug);
  if (!ctx) notFound();
  if (!hasRole(ctx.roles, allowed)) notFound();
  return ctx;
}

// ── Match-scoped authorization (spec/14 §A1) ─────────────────────────────────
//
// Authorization for the scoring surface must be keyed to the *match's* tenant
// (resolved server-side), not the URL or the user's primary tenant. Used by the
// events / lineup / interrupt / pdf routes and the live scoring page.

export interface MatchAuth {
  user: { id: string; email: string | null };
  tenantId: string;
  roles: Role[];
  /** Real admin while impersonating — attribute writes to this (spec/26 §8). */
  actor: ImpersonationActor | null;
}
export type MatchAuthResult =
  | { ok: true; auth: MatchAuth }
  | { ok: false; status: 401 | 403 | 404 };

/** Pure resolver (no throw/redirect) for Route Handlers. */
export async function authorizeMatch(
  matchId: string,
  allowed: Role[],
): Promise<MatchAuthResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };
  const row = (
    await db
      .select({ tenantId: matches.tenantId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, status: 404 };
  const roles = await rolesFor(user.id, row.tenantId);
  if (!hasRole(roles, allowed)) return { ok: false, status: 403 };
  return {
    ok: true,
    auth: {
      user: { id: user.id, email: user.email ?? null },
      tenantId: row.tenantId,
      roles,
      actor: (await getImpersonation())?.actor ?? null,
    },
  };
}

/** Page variant: redirect on 401, notFound on 403/404. */
export async function requireMatchRole(
  matchId: string,
  allowed: Role[],
  loginDest?: string,
): Promise<MatchAuth> {
  const r = await authorizeMatch(matchId, allowed);
  if (r.ok) return r.auth;
  if (r.status === 401)
    redirect(
      loginDest ? `/login?redirectTo=${encodeURIComponent(loginDest)}` : "/login",
    );
  notFound();
}

/** Role sets for the admin surfaces (see spec/10 §"Role-based access"). */
export const ADMIN_ROLES: Role[] = ["TENANT_ADMIN", "COMPETITION_ADMIN"];
/** Roles permitted to operate the scoring surface for a match. */
export const SCORING_ROLES: Role[] = [
  "SCORER",
  "COMPETITION_ADMIN",
  "TENANT_ADMIN",
];
/** Roles permitted to view read-only surfaces (matches, standings, boards). */
export const VIEW_ROLES: Role[] = [
  "VIEWER",
  "SCORER",
  "COMPETITION_ADMIN",
  "TENANT_ADMIN",
];
