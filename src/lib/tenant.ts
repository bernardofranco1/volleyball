import { cache } from "react";
import { unstable_cache } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  tenants,
  tenantBranding,
  tenantConfig,
  userTenantRoles,
} from "@/db/schema";
import {
  DISCIPLINES,
  REPORT_TYPES,
  isDiscipline,
  isReportType,
  type ReportType,
} from "@/lib/domain";
import type { Discipline } from "@/engine/types";

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

/**
 * Per-tenant capability config (spec/24 §2.1). Always a fully-resolved value —
 * callers never deal with "unset", they get the defaults.
 */
export interface TenantConfig {
  enabledDisciplines: Discipline[];
  enabledReportTypes: ReportType[];
}

export interface TenantWithBranding {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  branding: TenantBranding;
  config: TenantConfig;
}

export const DEFAULT_BRANDING: TenantBranding = {
  title: null,
  primaryColor: "#0066cc",
  secondaryColor: "#ffffff",
  logoUrl: null,
  fontFamily: null,
  courtColorOverrides: null,
};

/** No row (or an unreadable one) ⇒ everything enabled, i.e. today's behaviour. */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  enabledDisciplines: [...DISCIPLINES],
  enabledReportTypes: [...REPORT_TYPES],
};

/**
 * Coerce a stored jsonb array into a known-good list. Anything unrecognised is
 * dropped, and an empty or absent result falls back to "all" — a tenant must
 * never end up locked out of every discipline (or with an empty Reports tab)
 * because a row was hand-edited or an enum member was renamed.
 */
function resolveList<T extends string>(
  stored: unknown,
  allowed: readonly T[],
  guard: (v: string) => v is T,
): T[] {
  if (!Array.isArray(stored)) return [...allowed];
  const picked = stored.filter(
    (v): v is T => typeof v === "string" && guard(v),
  );
  return picked.length > 0 ? picked : [...allowed];
}

export function resolveTenantConfig(row: {
  enabledDisciplines?: unknown;
  enabledReportTypes?: unknown;
} | null): TenantConfig {
  if (!row) return DEFAULT_TENANT_CONFIG;
  return {
    enabledDisciplines: resolveList(
      row.enabledDisciplines,
      DISCIPLINES,
      isDiscipline,
    ),
    enabledReportTypes: resolveList(
      row.enabledReportTypes,
      REPORT_TYPES,
      isReportType,
    ),
  };
}

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
          // Joined into the same cached read rather than fetched separately:
          // the config gates nav entries and the Reports tab, so it is needed on
          // effectively every tenant page render (spec/24 §2.1).
          enabledDisciplines: tenantConfig.enabledDisciplines,
          enabledReportTypes: tenantConfig.enabledReportTypes,
        })
        .from(tenants)
        .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
        .leftJoin(tenantConfig, eq(tenantConfig.tenantId, tenants.id))
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
    config: resolveTenantConfig(r),
  };
});

/**
 * Capability config by tenant id, for paths that resolved a tenant from a match
 * rather than from a URL slug (the export routes). Cached per request; the row
 * is tiny and the export routes hit it once per download.
 */
export const getTenantConfigById = cache(async function getTenantConfigById(
  tenantId: string,
): Promise<TenantConfig> {
  const rows = await db
    .select({
      enabledDisciplines: tenantConfig.enabledDisciplines,
      enabledReportTypes: tenantConfig.enabledReportTypes,
    })
    .from(tenantConfig)
    .where(eq(tenantConfig.tenantId, tenantId))
    .limit(1);
  return resolveTenantConfig(rows[0] ?? null);
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
