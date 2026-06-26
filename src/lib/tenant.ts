import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants, tenantBranding, userTenantRoles } from "@/db/schema";

// Tenant resolution helpers. These query the database directly and therefore
// run only in Node-runtime contexts (Server Components, Route Handlers, Server
// Actions) — never in the edge Proxy.

export interface TenantBranding {
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
  branding: TenantBranding;
}

const DEFAULT_BRANDING: TenantBranding = {
  primaryColor: "#0066cc",
  secondaryColor: "#ffffff",
  logoUrl: null,
  fontFamily: null,
  courtColorOverrides: null,
};

/**
 * Resolve a tenant (with branding) by its URL slug, or null if not found.
 * Memoised per request (`cache`) so the layout, page, and authz share one query.
 */
export const getTenantBySlug = cache(async function getTenantBySlug(
  slug: string,
): Promise<TenantWithBranding | null> {
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      primaryColor: tenantBranding.primaryColor,
      secondaryColor: tenantBranding.secondaryColor,
      logoUrl: tenantBranding.logoUrl,
      fontFamily: tenantBranding.fontFamily,
      courtColorOverrides: tenantBranding.courtColorOverrides,
    })
    .from(tenants)
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    branding: {
      primaryColor: r.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      secondaryColor: r.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
      logoUrl: r.logoUrl,
      fontFamily: r.fontFamily,
      courtColorOverrides:
        (r.courtColorOverrides as Record<string, string> | null) ?? null,
    },
  };
});

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
    .where(eq(userTenantRoles.userId, userId))
    .limit(1);

  return rows[0]?.slug ?? null;
}
