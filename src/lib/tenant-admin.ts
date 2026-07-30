// Global-admin console queries + tenant purge (spec/23 §3). Server-only
// (direct DB access); the form Server Actions live in tenant-admin-actions.ts.
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
} from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  backupRuns,
  competitionBranding,
  competitions,
  csvImports,
  events,
  interruptRequests,
  matches,
  matchOfficials,
  matchSessions,
  matchSignatures,
  players,
  pools,
  poolTeams,
  teams,
  tenantBilling,
  tenantBranding,
  tenants,
  tournamentConfig,
  userTenantRoles,
} from "@/db/schema";
import { captureError } from "@/lib/observability";

/** Days a soft-deleted tenant stays restorable before the cron purges it. */
export const DELETE_GRACE_DAYS = 7;

export interface AdminTenantRow {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  title: string | null;
  logoUrl: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  competitionCount: number;
  matchCount: number;
  memberCount: number;
  lastFullBackupAt: Date | null;
}

/** Every tenant (including soft-deleted) with console stats, newest first. */
export async function listAllTenants(): Promise<AdminTenantRow[]> {
  const [rows, comps, mtchs, members, backups] = await Promise.all([
    db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        subdomain: tenants.subdomain,
        deletedAt: tenants.deletedAt,
        createdAt: tenants.createdAt,
        title: tenantBranding.title,
        logoUrl: tenantBranding.logoUrl,
      })
      .from(tenants)
      .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
      .orderBy(desc(tenants.createdAt)),
    db
      .select({ tenantId: competitions.tenantId, n: count() })
      .from(competitions)
      .groupBy(competitions.tenantId),
    db
      .select({ tenantId: matches.tenantId, n: count() })
      .from(matches)
      .groupBy(matches.tenantId),
    db
      .select({ tenantId: userTenantRoles.tenantId, n: count() })
      .from(userTenantRoles)
      .groupBy(userTenantRoles.tenantId),
    db
      .select({ tenantId: backupRuns.tenantId, last: max(backupRuns.startedAt) })
      .from(backupRuns)
      .where(and(eq(backupRuns.kind, "FULL"), eq(backupRuns.status, "OK")))
      .groupBy(backupRuns.tenantId),
  ]);

  const by = <T extends { tenantId: string }>(list: T[]) =>
    new Map(list.map((r) => [r.tenantId, r]));
  const compBy = by(comps);
  const matchBy = by(mtchs);
  const memberBy = by(members);
  const backupBy = by(backups);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    subdomain: r.subdomain,
    title: r.title,
    logoUrl: r.logoUrl,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    competitionCount: compBy.get(r.id)?.n ?? 0,
    matchCount: matchBy.get(r.id)?.n ?? 0,
    memberCount: memberBy.get(r.id)?.n ?? 0,
    lastFullBackupAt: backupBy.get(r.id)?.last ?? null,
  }));
}

/**
 * Lightweight tenant list for the global admin's header switcher: ONE query
 * (no stats). The switcher renders on every tenant page navigation — the full
 * listAllTenants (5 grouped queries) belongs on the console page only.
 */
export async function listTenantsForSwitcher(): Promise<
  {
    slug: string;
    name: string;
    subdomain: string | null;
    title: string | null;
    logoUrl: string | null;
  }[]
> {
  return db
    .select({
      slug: tenants.slug,
      name: tenants.name,
      subdomain: tenants.subdomain,
      title: tenantBranding.title,
      logoUrl: tenantBranding.logoUrl,
    })
    .from(tenants)
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(isNull(tenants.deletedAt))
    .orderBy(tenants.name);
}

export interface AdminTenantDetail {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  branding: {
    title: string | null;
    primaryColor: string;
    secondaryColor: string;
    logoUrl: string | null;
    fontFamily: string | null;
    courtColorOverrides: Record<string, string> | null;
  };
}

/** One tenant by id, soft-deleted included (the console must show those). */
export async function getTenantById(
  tenantId: string,
): Promise<AdminTenantDetail | null> {
  const r = (
    await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        subdomain: tenants.subdomain,
        deletedAt: tenants.deletedAt,
        createdAt: tenants.createdAt,
        title: tenantBranding.title,
        primaryColor: tenantBranding.primaryColor,
        secondaryColor: tenantBranding.secondaryColor,
        logoUrl: tenantBranding.logoUrl,
        fontFamily: tenantBranding.fontFamily,
        courtColorOverrides: tenantBranding.courtColorOverrides,
      })
      .from(tenants)
      .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    subdomain: r.subdomain,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    branding: {
      title: r.title,
      primaryColor: r.primaryColor ?? "#0066cc",
      secondaryColor: r.secondaryColor ?? "#ffffff",
      logoUrl: r.logoUrl,
      fontFamily: r.fontFamily,
      courtColorOverrides:
        (r.courtColorOverrides as Record<string, string> | null) ?? null,
    },
  };
}

/** True when the tenant has a match currently in play. */
export async function hasLiveMatch(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "LIVE")))
    .limit(1);
  return rows.length > 0;
}

/**
 * Hard-delete every row belonging to a tenant, children first (FK order).
 * Backup objects in storage are deliberately KEPT for the retention window.
 * Only called on tenants whose grace period expired (or never — restores are
 * the expected path).
 */
export async function hardDeleteTenant(tenantId: string): Promise<void> {
  const compIds = db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.tenantId, tenantId));
  const poolIds = db
    .select({ id: pools.id })
    .from(pools)
    .where(eq(pools.tenantId, tenantId));

  await db.transaction(async (tx) => {
    await tx.delete(events).where(eq(events.tenantId, tenantId));
    await tx.delete(matchSessions).where(eq(matchSessions.tenantId, tenantId));
    await tx
      .delete(interruptRequests)
      .where(eq(interruptRequests.tenantId, tenantId));
    await tx.delete(matchOfficials).where(eq(matchOfficials.tenantId, tenantId));
    await tx
      .delete(matchSignatures)
      .where(eq(matchSignatures.tenantId, tenantId));
    await tx.delete(matches).where(eq(matches.tenantId, tenantId));
    await tx.delete(players).where(eq(players.tenantId, tenantId));
    await tx.delete(poolTeams).where(inArray(poolTeams.poolId, poolIds));
    await tx.delete(teams).where(eq(teams.tenantId, tenantId));
    await tx.delete(pools).where(eq(pools.tenantId, tenantId));
    await tx
      .delete(tournamentConfig)
      .where(inArray(tournamentConfig.competitionId, compIds));
    await tx
      .delete(competitionBranding)
      .where(inArray(competitionBranding.competitionId, compIds));
    await tx.delete(competitions).where(eq(competitions.tenantId, tenantId));
    await tx.delete(csvImports).where(eq(csvImports.tenantId, tenantId));
    await tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId));
    await tx
      .delete(userTenantRoles)
      .where(eq(userTenantRoles.tenantId, tenantId));
    await tx.delete(tenantBilling).where(eq(tenantBilling.tenantId, tenantId));
    await tx.delete(backupRuns).where(eq(backupRuns.tenantId, tenantId));
    await tx.delete(tenantBranding).where(eq(tenantBranding.tenantId, tenantId));
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
  });
}

/**
 * Purge tenants whose soft-delete grace period has expired (spec/23 §3.4).
 * Called from the daily backup cron. Best-effort per tenant — one failing
 * purge must not block the others (or the backups that ran before it).
 */
export async function purgeExpiredTenants(): Promise<string[]> {
  const cutoff = new Date(Date.now() - DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(and(isNotNull(tenants.deletedAt), lt(tenants.deletedAt, cutoff)));

  const purged: string[] = [];
  for (const t of expired) {
    try {
      await hardDeleteTenant(t.id);
      purged.push(t.slug);
    } catch (err) {
      captureError(err, { scope: "tenant-purge", tenantId: t.id });
    }
  }
  return purged;
}

/** Non-deleted tenants, for the backup cron's iteration order (oldest first). */
export async function listLiveTenantIds(): Promise<
  { id: string; slug: string }[]
> {
  return db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(isNull(tenants.deletedAt))
    .orderBy(tenants.createdAt);
}
