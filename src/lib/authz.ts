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
import { matches, userTenantRoles } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getTenantBySlug, type TenantWithBranding } from "@/lib/tenant";

export type Role = "TENANT_ADMIN" | "COMPETITION_ADMIN" | "SCORER";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: TenantWithBranding;
  roles: Role[];
}

/**
 * The authenticated user for this request, memoised so the proxy, layout, page,
 * and any nested guard share a single `getUser()` network validation (D / M3).
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** TENANT_ADMIN is a superuser within its tenant and satisfies any requirement. */
function hasRole(roles: Role[], allowed: Role[]): boolean {
  if (roles.includes("TENANT_ADMIN")) return true;
  return roles.some((r) => allowed.includes(r));
}

async function rolesFor(userId: string, tenantId: string): Promise<Role[]> {
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
 * Resolve the current user, the tenant for `slug`, and the user's roles in it.
 * Returns null when there is no authenticated user or the tenant doesn't exist.
 */
export async function getAuthContext(
  tenantSlug: string,
): Promise<AuthContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;
  return {
    user: { id: user.id, email: user.email ?? null },
    tenant,
    roles: await rolesFor(user.id, tenant.id),
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
