// Admin audit log (Phase 11). `recordAudit` is best-effort and never throws — an
// audit failure must not break the operation it records. `listAudit` powers the
// viewer page. Instrumented at sensitive mutations: competition lifecycle/config,
// deletes, bracket generate/advance, branding, team-tablet token issuance, and
// bulk CSV imports.
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { newId } from "@/lib/id";

export interface AuditActor {
  userId?: string | null;
  email?: string | null;
}

export interface AuditInput {
  tenantId: string;
  actor?: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: newId("aud"),
      tenantId: input.tenantId,
      actorUserId: input.actor?.userId ?? null,
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
    });
  } catch {
    // Never let an audit write break the mutation it records.
  }
}

export type AuditRow = typeof auditLog.$inferSelect;

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
