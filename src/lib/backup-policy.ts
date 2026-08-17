// Pure backup policy (spec/23 §7) — constants, naming and retention math with
// NO runtime dependencies (no db, no storage, no zlib). Split from backup.ts
// so tests and other callers can import the policy without dragging in the
// postgres/supabase graph. backup.ts re-exports everything here.
//
// `scopedStoragePath` is the one import, and it is dependency-free too: it
// reads DB_SCHEMA and returns a string.
import { scopedStoragePath } from "@/db/env";

export const BACKUP_BUCKET = "backups";

/** Bump when the export document shape changes (not on every schema change). */
export const BACKUP_FORMAT_VERSION = 1;

/**
 * The drizzle migration journal index the exporter was written against.
 * scripts/restore-backup.mts refuses files whose idx is ahead of the target
 * database. A unit test asserts this matches src/db/migrations/meta/_journal.json
 * so it can't silently drift.
 */
export const MIGRATION_JOURNAL_IDX = 21;

/**
 * DB table names covered by a FULL export, in FK-safe restore order.
 * `backup_runs` is deliberately absent (backup metadata, not tenant data).
 * A schema-introspection test fails when a future tenant-scoped table is
 * missing here — the classic silent-backup-rot bug.
 */
export const EXPORTED_TABLES = [
  "tenants",
  "tenant_branding",
  "tenant_billing",
  "tenant_config",
  "users",
  "user_tenant_roles",
  // people precede everything that references them (players, match_officials,
  // team_staff); person_roles follows people.
  "people",
  "person_roles",
  "competitions",
  "tournament_config",
  "competition_branding",
  "pools",
  "teams", // teams.pool_id → pools, pools precede teams
  "team_staff", // → teams + people, both above
  "pool_teams",
  "players",
  "matches",
  "events",
  "match_sessions",
  "interrupt_requests",
  "match_officials",
  "match_signatures",
  "csv_imports",
  "audit_log",
] as const;

export type BackupKind = "FULL" | "INCREMENTAL";
export type BackupTrigger = "CRON" | "EVENT" | "MANUAL";

/**
 * Storage key for a run's object: daily-named fulls, ms-timestamped incrementals.
 *
 * Prefixed with the environment (spec/28): the `backups` bucket is global to the
 * Supabase project and the clone shares production's tenant ids, so without this
 * a homologation FULL would upsert straight onto production's backup for that
 * tenant and day — destroying the recovery point a promotion had just taken.
 * The prefix is empty in production, so existing keys are unchanged.
 */
export function objectPathFor(
  tenantId: string,
  kind: BackupKind,
  scope?: { competitionId: string },
  now: Date = new Date(),
): string {
  return scopedStoragePath(tenantFolder(tenantId, kind, scope, now));
}

/** The un-prefixed part — also the listing path used by retention. */
function tenantFolder(
  tenantId: string,
  kind: BackupKind,
  scope?: { competitionId: string },
  now: Date = new Date(),
): string {
  if (kind === "FULL") {
    return `${tenantId}/full/${now.toISOString().slice(0, 10)}.json.gz`;
  }
  // Millisecond timestamp keeps paths unique; colon is not storage-key safe.
  const ts = now.toISOString().replace(/[:.]/g, "-");
  return `${tenantId}/incremental/${ts}-${scope?.competitionId ?? "unknown"}.json.gz`;
}

/**
 * Prefix for one tenant's objects of a kind — what retention lists and deletes.
 * Same namespacing as `objectPathFor`, so pruning in homologation can never
 * reach production's objects.
 */
export function backupFolderFor(tenantId: string, kind: BackupKind): string {
  return scopedStoragePath(
    `${tenantId}/${kind === "FULL" ? "full" : "incremental"}`,
  );
}

/** Debounce window for event-triggered incrementals (a set ending fires bursts). */
export const INCREMENTAL_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Slug of the tenant excluded from event-triggered incrementals: the nightly
 * demo reseed would otherwise generate a steady stream of churn objects. Its
 * daily FULL still runs.
 */
export const TEST_TENANT_SLUG = "volleyball-scoring";

/** How many daily FULL objects to keep per tenant. */
export const FULL_BACKUPS_KEPT = 30;

/**
 * Pure retention policy (spec/23 §7.2). `fullNamesDesc` sorted newest first
 * (names are YYYY-MM-DD, so lexicographic desc). Keeps the newest
 * FULL_BACKUPS_KEPT fulls; incrementals older than the oldest kept full expire
 * (incremental names start with an ISO timestamp, so comparing the 10-char
 * date prefixes is chronological).
 */
export function selectExpiredBackups(
  fullNamesDesc: string[],
  incrementalNames: string[],
): { expiredFulls: string[]; expiredIncrementals: string[] } {
  const expiredFulls = fullNamesDesc.slice(FULL_BACKUPS_KEPT);
  const oldestKept = fullNamesDesc.slice(0, FULL_BACKUPS_KEPT).at(-1) ?? null;
  const expiredIncrementals = oldestKept
    ? incrementalNames.filter((name) => name.slice(0, 10) < oldestKept.slice(0, 10))
    : [];
  return { expiredFulls, expiredIncrementals };
}
