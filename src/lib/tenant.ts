import { cache } from "react";
import { unstable_cache } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tenants, tenantBranding, userTenantRoles } from "@/db/schema";

// Tenant resolution helpers. These query the database directly and therefore
// run only in Node-runtime contexts (Server Components, Route Handlers, Server
// Actions) — never in the edge Proxy.

export interface TenantBranding {
  /** Display title shown instead of "Volleyball Scoring" (null → tenant name). */
  title: string | null;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  fontFamily: string | null;
  courtColorOverrides: Record<string, string> | null;
}

export interface TenantWithBranding {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  branding: TenantBranding;
}

export const DEFAULT_BRANDING: TenantBranding = {
  title: null,
  primaryColor: "#0066cc",
  secondaryColor: "#ffffff",
  logoUrl: null,
  fontFamily: null,
  courtColorOverrides: null,
};

/** The tenant's user-facing product name (spec/23 §5.1). */
export function tenantTitle(tenant: {
  name: string;
  branding: { title: string | null };
}): string {
  return tenant.branding.title ?? tenant.name;
}

/**
 * Resolve a tenant (with branding) by its URL slug, or null if not found.
 * Soft-deleted tenants (spec/23 §3.4) resolve to null — every URL goes dark
 * the moment the tenant is deleted.
 * Loaded on every tenant page (in the layout), so it's cached two ways:
 *   - React `cache` de-dupes the call within a single request.
 *   - `unstable_cache` (data cache, tag `tenant:<slug>`) serves it across
 *     requests so navigation doesn't re-query; `updateBranding` revalidates the
 *     tag, with a 5-min TTL as a safety net. Returns only JSON-safe values.
 */
export const getTenantBySlug = cache(async function getTenantBySlug(
  slug: string,
): Promise<TenantWithBranding | null> {
  const r = await unstable_cache(
    async () => {
      const rows = await db
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          subdomain: tenants.subdomain,
          title: tenantBranding.title,
          primaryColor: tenantBranding.primaryColor,
          secondaryColor: tenantBranding.secondaryColor,
          logoUrl: tenantBranding.logoUrl,
          fontFamily: tenantBranding.fontFamily,
          courtColorOverrides: tenantBranding.courtColorOverrides,
        })
        .from(tenants)
        .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
        .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    },
    ["tenant-by-slug", slug],
    { tags: [`tenant:${slug}`], revalidate: 60 },
  )();

  if (!r) return null;

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    subdomain: r.subdomain,
    branding: {
      title: r.title,
      primaryColor: r.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      secondaryColor: r.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
      logoUrl: r.logoUrl,
      fontFamily: r.fontFamily,
      courtColorOverrides:
        (r.courtColorOverrides as Record<string, string> | null) ?? null,
    },
  };
});

/** A tenant a user can switch into, with what the switcher renders. */
export interface UserTenant {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  title: string | null;
  logoUrl: string | null;
  roles: string[];
}

/**
 * Every live tenant the user is a member of (spec/23 §4) — drives the header
 * switcher and the /select-tenant picker. Global admins don't use this: they
 * see ALL tenants (listAllTenants in tenant-admin.ts).
 */
export async function getUserTenants(userId: string): Promise<UserTenant[]> {
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      subdomain: tenants.subdomain,
      title: tenantBranding.title,
      logoUrl: tenantBranding.logoUrl,
      role: userTenantRoles.role,
    })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(tenants.id, userTenantRoles.tenantId))
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(and(eq(userTenantRoles.userId, userId), isNull(tenants.deletedAt)))
    .orderBy(asc(tenants.name));

  // One user can hold several roles in a tenant — collapse to one entry.
  const byId = new Map<string, UserTenant>();
  for (const r of rows) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.roles.push(r.role);
    } else {
      byId.set(r.id, {
        id: r.id,
        slug: r.slug,
        name: r.name,
        subdomain: r.subdomain,
        title: r.title,
        logoUrl: r.logoUrl,
        roles: [r.role],
      });
    }
  }
  return [...byId.values()];
}

/**
 * The slug of the first tenant a user belongs to. Used after login to send the
 * user to their dashboard. Returns null if the user has no tenant role yet.
 */
export async function getUserPrimaryTenantSlug(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ slug: tenants.slug })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(tenants.id, userTenantRoles.tenantId))
    .where(and(eq(userTenantRoles.userId, userId), isNull(tenants.deletedAt)))
    .limit(1);

  return rows[0]?.slug ?? null;
}
