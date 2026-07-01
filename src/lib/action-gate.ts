// Shared authorization gate for competition-scoped Server Actions. Verifies the
// caller has an admin role on the tenant in the form data AND that the target
// competition belongs to that tenant. One definition — the per-file copies had
// drifted in return shape.

import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { str } from "@/lib/form-data";

export interface CompetitionGate {
  tenantSlug: string;
  competitionId: string;
  tenantId: string;
  discipline: Discipline;
  status: "DRAFT" | "ACTIVE" | "FINISHED";
  actor: { userId: string; email: string | null };
}

export async function gateCompetition(
  fd: FormData,
): Promise<CompetitionGate | null> {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return null;
  return {
    tenantSlug,
    competitionId,
    tenantId: ctx.tenant.id,
    discipline: comp.discipline as Discipline,
    status: comp.status,
    actor: { userId: ctx.user.id, email: ctx.user.email },
  };
}
