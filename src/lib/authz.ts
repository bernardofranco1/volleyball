// Authorization helpers for tenant admin surfaces (Phase 3+).
//
// The Proxy (src/proxy.ts) only does an optimistic "is there a session" check.
// Real authorization — which tenant, which role — is verified here, against the
// database, inside Server Components and Server Actions. Per the Next.js Data
// Security guidance, every mutation re-checks; never trust the proxy alone.
//
// Node-runtime only (queries the DB + reads the auth cookie).
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { userTenantRoles } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getTenantBySlug, type TenantWithBranding } from "@/lib/tenant";

export type Role = "TENANT_ADMIN" | "COMPETITION_ADMIN" | "SCORER";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: TenantWithBranding;
  roles: Role[];
}

/**
 * Resolve the current user, the tenant for `slug`, and the user's roles in it.
 * Returns null when there is no authenticated user or the tenant doesn't exist.
 */
export async function getAuthContext(
  tenantSlug: string,
): Promise<AuthContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;

  const rows = await db
    .select({ role: userTenantRoles.role })
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, user.id),
        eq(userTenantRoles.tenantId, tenant.id),
      ),
    );

  return {
    user: { id: user.id, email: user.email ?? null },
    tenant,
    roles: rows.map((r) => r.role as Role),
  };
}

/** TENANT_ADMIN is a superuser within its tenant and satisfies any requirement. */
function hasRole(roles: Role[], allowed: Role[]): boolean {
  if (roles.includes("TENANT_ADMIN")) return true;
  return roles.some((r) => allowed.includes(r));
}

/**
 * Gate a page or Server Action on tenant membership + role.
 *
 *   - no session            → redirect to /login (preserving destination on pages)
 *   - unknown tenant        → notFound()
 *   - insufficient role     → notFound() (don't reveal the resource exists)
 *
 * Returns the AuthContext when access is granted. Safe in both Server Components
 * and Server Actions: redirect()/notFound() throw framework control-flow signals.
 */
export async function requireRole(
  tenantSlug: string,
  allowed: Role[],
  redirectTo?: string,
): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

/** Role sets for the Phase 3 admin surfaces (see spec/10 §"Role-based access"). */
export const ADMIN_ROLES: Role[] = ["TENANT_ADMIN", "COMPETITION_ADMIN"];
