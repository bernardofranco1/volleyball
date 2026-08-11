// Per-tenant logical backups (spec/23 §7).
//
// A backup is one gzipped JSON document holding every row that belongs to a
// tenant (FULL) or to one competition subtree (INCREMENTAL — a differential
// *snapshot*, not a row-delta log: restorable standalone and immune to
// missed-delta corruption). Objects live in the private Supabase Storage
// bucket `backups`; every attempt — including failures — is a `backup_runs`
// row so a missed backup is visible instead of silently absent.
//
// Restores are deliberately NOT triggered from the app: scripts/restore-backup.mts
// is run by an operator against an explicit DATABASE_URL.
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
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
  people,
  personRoles,
  players,
  pools,
  poolTeams,
  teams,
  teamStaff,
  tenantBilling,
  tenantBranding,
  tenantConfig,
  tenants,
  tournamentConfig,
  users,
  userTenantRoles,
} from "@/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { captureError } from "@/lib/observability";
import { newId } from "@/lib/id";
import {
  BACKUP_BUCKET,
  BACKUP_FORMAT_VERSION,
  INCREMENTAL_DEBOUNCE_MS,
  MIGRATION_JOURNAL_IDX,
  TEST_TENANT_SLUG,
  objectPathFor,
  selectExpiredBackups,
  type BackupKind,
  type BackupTrigger,
} from "@/lib/backup-policy";

// Pure policy (constants, naming, retention math) lives in backup-policy.ts —
// re-exported so existing importers and tests keep one entry point.
export * from "@/lib/backup-policy";

const gzipAsync = promisify(gzip);

export interface TenantExport {
  formatVersion: number;
  migrationJournalIdx: number;
  kind: BackupKind;
  tenantId: string;
  exportedAt: string;
  scope: { competitionId?: string } | null;
  tables: Record<string, unknown[]>;
}

/**
 * Build the export document. FULL = every tenant-owned row. With a
 * `competitionId` scope = the competition subtree plus the small tenant-level
 * tables (tenant, branding, memberships) that a standalone restore needs;
 * tenant-wide logs (audit, csv imports) are FULL-only.
 */
export async function exportTenant(
  tenantId: string,
  scope?: { competitionId: string },
): Promise<TenantExport> {
  const compFilter = scope
    ? and(eq(competitions.tenantId, tenantId), eq(competitions.id, scope.competitionId))
    : eq(competitions.tenantId, tenantId);
  const compIds = db
    .select({ id: competitions.id })
    .from(competitions)
    .where(compFilter);
  const poolIds = db
    .select({ id: pools.id })
    .from(pools)
    .where(inArray(pools.competitionId, compIds));
  const teamIds = db
    .select({ id: teams.id })
    .from(teams)
    .where(inArray(teams.competitionId, compIds));
  const matchIds = db
    .select({ id: matches.id })
    .from(matches)
    .where(inArray(matches.competitionId, compIds));

  // Members: only the user rows referenced by this tenant's roles.
  const memberIds = db
    .select({ id: userTenantRoles.userId })
    .from(userTenantRoles)
    .where(eq(userTenantRoles.tenantId, tenantId));

  const tables: Record<string, unknown[]> = {
    tenants: await db.select().from(tenants).where(eq(tenants.id, tenantId)),
    tenant_branding: await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId)),
    tenant_billing: await db
      .select()
      .from(tenantBilling)
      .where(eq(tenantBilling.tenantId, tenantId)),
    tenant_config: await db
      .select()
      .from(tenantConfig)
      .where(eq(tenantConfig.tenantId, tenantId)),
    users: await db.select().from(users).where(inArray(users.id, memberIds)),
    user_tenant_roles: await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.tenantId, tenantId)),
    // Tenant-level, so included in an INCREMENTAL competition export too: a
    // standalone restore of one competition needs the people its rosters point at.
    people: await db.select().from(people).where(eq(people.tenantId, tenantId)),
    person_roles: await db
      .select()
      .from(personRoles)
      .where(eq(personRoles.tenantId, tenantId)),
    competitions: await db.select().from(competitions).where(compFilter),
    tournament_config: await db
      .select()
      .from(tournamentConfig)
      .where(inArray(tournamentConfig.competitionId, compIds)),
    competition_branding: await db
      .select()
      .from(competitionBranding)
      .where(inArray(competitionBranding.competitionId, compIds)),
    pools: await db.select().from(pools).where(inArray(pools.competitionId, compIds)),
    teams: await db
      .select()
      .from(teams)
      .where(inArray(teams.competitionId, compIds)),
    team_staff: await db
      .select()
      .from(teamStaff)
      .where(inArray(teamStaff.teamId, teamIds)),
    pool_teams: await db
      .select()
      .from(poolTeams)
      .where(inArray(poolTeams.poolId, poolIds)),
    players: await db
      .select()
      .from(players)
      .where(inArray(players.teamId, teamIds)),
    matches: await db
      .select()
      .from(matches)
      .where(inArray(matches.competitionId, compIds)),
    events: await db
      .select()
      .from(events)
      .where(inArray(events.matchId, matchIds)),
    match_sessions: await db
      .select()
      .from(matchSessions)
      .where(inArray(matchSessions.matchId, matchIds)),
    interrupt_requests: await db
      .select()
      .from(interruptRequests)
      .where(inArray(interruptRequests.matchId, matchIds)),
    match_officials: await db
      .select()
      .from(matchOfficials)
      .where(inArray(matchOfficials.matchId, matchIds)),
    match_signatures: await db
      .select()
      .from(matchSignatures)
      .where(inArray(matchSignatures.matchId, matchIds)),
    csv_imports: scope
      ? []
      : await db.select().from(csvImports).where(eq(csvImports.tenantId, tenantId)),
    audit_log: scope
      ? []
      : await db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)),
  };

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    migrationJournalIdx: MIGRATION_JOURNAL_IDX,
    kind: scope ? "INCREMENTAL" : "FULL",
    tenantId,
    exportedAt: new Date().toISOString(),
    scope: scope ?? null,
    tables,
  };
}

export interface BackupResult {
  runId: string;
  ok: boolean;
  objectPath?: string;
  sizeBytes?: number;
  error?: string;
}

/**
 * Execute one backup end-to-end: RUNNING row → export → gzip → upload → OK,
 * or FAILED with the error recorded. Never throws — the caller inspects `ok`.
 * A same-day FULL re-run overwrites that day's object (upsert) — the latest
 * state of the day wins, which is exactly what a manual "Back up now" wants.
 */
export async function runBackup(opts: {
  tenantId: string;
  kind: BackupKind;
  trigger: BackupTrigger;
  scope?: { competitionId: string };
}): Promise<BackupResult> {
  const runId = newId("bkp");
  const objectPath = objectPathFor(opts.tenantId, opts.kind, opts.scope);
  await db.insert(backupRuns).values({
    id: runId,
    tenantId: opts.tenantId,
    kind: opts.kind,
    trigger: opts.trigger,
    scope: opts.scope ?? null,
    status: "RUNNING",
    objectPath,
  });

  try {
    const doc = await exportTenant(
      opts.tenantId,
      opts.kind === "INCREMENTAL" ? opts.scope : undefined,
    );
    // Async gzip: compressing a whole tenant export synchronously blocked this
    // instance's event loop, and a backup can be triggered from a scoring
    // request's after() hook (spec/24 §9.5 F6).
    const body = await gzipAsync(Buffer.from(JSON.stringify(doc)), { level: 6 });
    const rowCounts = Object.fromEntries(
      Object.entries(doc.tables).map(([name, rows]) => [name, rows.length]),
    );

    const admin = createSupabaseAdminClient();
    const { error } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(objectPath, body, {
        contentType: "application/gzip",
        upsert: true,
      });
    if (error) throw new Error(`storage upload failed: ${error.message}`);

    await db
      .update(backupRuns)
      .set({
        status: "OK",
        sizeBytes: body.byteLength,
        rowCounts,
        finishedAt: new Date(),
      })
      .where(eq(backupRuns.id, runId));
    return { runId, ok: true, objectPath, sizeBytes: body.byteLength };
  } catch (err) {
    captureError(err, { scope: "backup", tenantId: opts.tenantId, kind: opts.kind });
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db
        .update(backupRuns)
        .set({ status: "FAILED", error: message, finishedAt: new Date() })
        .where(eq(backupRuns.id, runId));
    } catch {
      // The FAILED marker is best-effort: if even this write fails we still
      // report the original error to the caller.
    }
    return { runId, ok: false, error: message };
  }
}

/**
 * Event hook (spec/23 §7.4): fire an incremental backup for a competition,
 * debounced to one per 5 minutes. Best-effort and never throws — it runs
 * inside `after()` on scoring/admin paths that must not fail on backup
 * trouble. Callers invoke it only on real transitions (status change,
 * creation), never per rally.
 */
export async function scheduleIncrementalBackup(
  tenantId: string,
  competitionId: string,
): Promise<void> {
  try {
    const tenant = (
      await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (!tenant || tenant.slug === TEST_TENANT_SLUG) return;

    const cutoff = new Date(Date.now() - INCREMENTAL_DEBOUNCE_MS);
    if (await hasRecentForCompetition(tenantId, competitionId, cutoff)) return;

    await runBackup({
      tenantId,
      kind: "INCREMENTAL",
      trigger: "EVENT",
      scope: { competitionId },
    });
  } catch (err) {
    captureError(err, { scope: "backup-incremental", tenantId, competitionId });
  }
}

async function hasRecentForCompetition(
  tenantId: string,
  competitionId: string,
  cutoff: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: backupRuns.id, scope: backupRuns.scope, status: backupRuns.status })
    .from(backupRuns)
    .where(
      and(
        eq(backupRuns.tenantId, tenantId),
        eq(backupRuns.kind, "INCREMENTAL"),
        gte(backupRuns.startedAt, cutoff),
      ),
    );
  return rows.some(
    (r) => r.status !== "FAILED" && r.scope?.competitionId === competitionId,
  );
}

/**
 * Retention (spec/23 §7.2): keep the newest 30 fulls; drop incrementals older
 * than the oldest kept full. Runs inside the daily cron after the fulls.
 */
export async function pruneBackups(tenantId: string): Promise<{
  deleted: number;
}> {
  const admin = createSupabaseAdminClient();
  const bucket = admin.storage.from(BACKUP_BUCKET);

  const fulls = await bucket.list(`${tenantId}/full`, {
    limit: 1000,
    sortBy: { column: "name", order: "desc" }, // names are YYYY-MM-DD → newest first
  });
  if (fulls.error) throw new Error(`list fulls failed: ${fulls.error.message}`);
  const incr = await bucket.list(`${tenantId}/incremental`, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (incr.error) throw new Error(`list incrementals failed: ${incr.error.message}`);

  const { expiredFulls, expiredIncrementals } = selectExpiredBackups(
    (fulls.data ?? []).map((o) => o.name),
    (incr.data ?? []).map((o) => o.name),
  );

  const toDelete = [
    ...expiredFulls.map((n) => `${tenantId}/full/${n}`),
    ...expiredIncrementals.map((n) => `${tenantId}/incremental/${n}`),
  ];
  if (toDelete.length > 0) {
    const { error } = await bucket.remove(toDelete);
    if (error) throw new Error(`prune remove failed: ${error.message}`);
  }
  return { deleted: toDelete.length };
}

export type BackupRunRow = typeof backupRuns.$inferSelect;

/** Recent runs for the admin console (all tenants). */
export async function listBackupRuns(limit = 100): Promise<BackupRunRow[]> {
  return db
    .select()
    .from(backupRuns)
    .orderBy(desc(backupRuns.startedAt))
    .limit(limit);
}

/** Recent runs for one tenant (its console page). */
export async function listTenantBackupRuns(
  tenantId: string,
  limit = 20,
): Promise<BackupRunRow[]> {
  return db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.tenantId, tenantId))
    .orderBy(desc(backupRuns.startedAt))
    .limit(limit);
}

/** Signed download URL for a completed run's object (60 minutes). */
export async function backupDownloadUrl(objectPath: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(objectPath, 3600);
  if (error) return null;
  return data.signedUrl;
}
