// Admin audit log (Phase 11). `recordAudit` is best-effort and never throws — an
// audit failure must not break the operation it records. `listAudit` powers the
// tenant viewer, `listPlatformAudit` the /admin one (tenantId null = platform
// event: impersonation, global-admin flags, password resets — spec/26 §9). Instrumented at sensitive mutations: competition lifecycle/config,
// deletes, bracket generate/advance, branding, team-tablet token issuance, and
// bulk CSV imports.
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { captureError } from "@/lib/observability";
import { newId } from "@/lib/id";

export interface AuditActor {
  userId?: string | null;
  email?: string | null;
}

export interface AuditInput {
  /** null for platform-level events that belong to no tenant (spec/26 §9). */
  tenantId: string | null;
  actor?: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    // Attribution rule (spec/26 §8): while a "sign in as…" overlay is active,
    // the row names the REAL admin and marks who was being tested. Centralised
    // here so every audit site — including ones written later — is covered.
    // Deliberately tolerant: outside a request (provisioning scripts) there is
    // no cookie store, and an audit row must still be written.
    let actor = input.actor;
    let metadata = input.metadata;
    try {
      const { getImpersonation } = await import("@/lib/authz");
      const imp = await getImpersonation();
      if (imp) {
        actor = { userId: imp.actor.id, email: imp.actor.email };
        metadata = { ...(metadata ?? {}), impersonating: imp.target.id };
      }
    } catch {
      // no request scope — keep the caller's actor as-is
    }

    await db.insert(auditLog).values({
      id: newId("aud"),
      tenantId: input.tenantId,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      metadata: metadata ?? null,
    });
  } catch (err) {
    // Never let an audit write break the mutation it records; surface to
    // monitoring (no-op until a Sentry DSN is set).
    captureError(err, { scope: "audit", action: input.action });
  }
}

export type AuditRow = typeof auditLog.$inferSelect;

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  /** Exact action, e.g. "competition.activate". */
  action?: string;
  /** Free text over the actor's email and the summary line. */
  q?: string;
}

function auditConds(tenantId: string, f: AuditFilters) {
  const conds = [eq(auditLog.tenantId, tenantId)];
  if (f.action) conds.push(eq(auditLog.action, f.action));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q}%`;
    conds.push(
      sql`(coalesce(${auditLog.actorEmail}, '') ilike ${like} or coalesce(${auditLog.summary}, '') ilike ${like})`,
    );
  }
  return conds;
}

/**
 * Filtered, paginated audit for the tenant viewer.
 *
 * The old viewer showed the newest 200 rows and stopped — with no filter and no
 * page two, anything older than a busy fortnight was simply unreachable from
 * the UI, which defeats the point of keeping the record.
 */
export async function listAuditPage(
  tenantId: string,
  opts: AuditFilters & { page?: number; paginate?: boolean } = {},
): Promise<{ rows: AuditRow[]; hasMore: boolean; total: number }> {
  const page = Math.max(0, opts.page ?? 0);
  const paginate = opts.paginate !== false;
  const conds = auditConds(tenantId, opts);
  const [rows, totals] = await Promise.all([
    paginate
      ? db
          .select()
          .from(auditLog)
          .where(and(...conds))
          .orderBy(desc(auditLog.createdAt))
          .limit(AUDIT_PAGE_SIZE + 1)
          .offset(page * AUDIT_PAGE_SIZE)
      : db
          .select()
          .from(auditLog)
          .where(and(...conds))
          .orderBy(desc(auditLog.createdAt))
          .limit(10000),
    db
      .select({ n: count() })
      .from(auditLog)
      .where(and(...conds)),
  ]);
  return {
    rows: paginate ? rows.slice(0, AUDIT_PAGE_SIZE) : rows,
    hasMore: paginate && rows.length > AUDIT_PAGE_SIZE,
    total: Number(totals[0]?.n ?? 0),
  };
}

/** Distinct actions present for this tenant — the viewer's filter options. */
export async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId));
  return rows.map((r) => r.action).sort();
}

export async function listAudit(
  tenantId: string,
  limit = 100,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** Platform-level rows (no tenant) — the /admin audit viewer. */
export async function listPlatformAudit(limit = 200): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(isNull(auditLog.tenantId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
