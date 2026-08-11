"use server";

// Per-tenant capability configuration (spec/24 §4, §5): which disciplines this
// tenant may run competitions in, and which match documents its Reports tab
// offers. TENANT_ADMIN only, and mirrored on the global-admin tenant page.
//
// Both lists are stored as jsonb string arrays and validated here against the
// domain constants, so an unknown value can never be persisted. Readers
// (resolveTenantConfig) validate again — the UI is not the security boundary and
// a row could have been written by hand or by an older deploy.
import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/db";
import { tenantConfig } from "@/db/schema";
import { requireGlobalAdmin, requireRole } from "@/lib/authz";
import { getTenantById } from "@/lib/tenant-admin";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import {
  CORE_REPORT_TYPES,
  DISCIPLINES,
  REPORT_TYPES,
  isDiscipline,
  isReportType,
} from "@/lib/domain";

/**
 * Checkbox groups post one entry per ticked box under the same name. An absent
 * name means "none ticked", which the callers below reject rather than storing —
 * a tenant with no disciplines could not create anything, and one with no core
 * report types would have a permanently empty Reports tab.
 */
function pickList<T extends string>(
  fd: FormData,
  field: string,
  guard: (v: string) => v is T,
): T[] {
  const raw = fd.getAll(field).map(String);
  // De-dupe: a repeated value would otherwise be stored twice and render twice.
  return [...new Set(raw.filter(guard))];
}

async function persist(
  tenantId: string,
  values: {
    enabledDisciplines?: string[];
    enabledReportTypes?: string[];
  },
): Promise<void> {
  await db
    .insert(tenantConfig)
    .values({
      tenantId,
      enabledDisciplines: values.enabledDisciplines ?? [...DISCIPLINES],
      enabledReportTypes: values.enabledReportTypes ?? [...REPORT_TYPES],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantConfig.tenantId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * Invalidate both the tagged tenant read (getTenantBySlug bundles the config)
 * and the rendered tenant layout, which gates nav entries on it.
 */
function revalidateTenant(slug: string): void {
  revalidatePath(`/t/${slug}`, "layout");
  updateTag(`tenant:${slug}`);
}

/** Set which disciplines a tenant may create competitions in. TENANT_ADMIN. */
export async function updateEnabledDisciplines(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"]);

  const enabledDisciplines = pickList(fd, "disciplines", isDiscipline);
  if (enabledDisciplines.length === 0)
    return fail("Enable at least one discipline.");

  await persist(ctx.tenant.id, { enabledDisciplines });
  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "tenant-config.disciplines",
    entityType: "tenant",
    entityId: ctx.tenant.id,
    summary: `Enabled disciplines: ${enabledDisciplines.join(", ")}`,
    metadata: { enabledDisciplines },
  });

  revalidateTenant(tenantSlug);
  return ok("Disciplines saved.");
}

/** Set which report types a tenant's Reports tab offers. TENANT_ADMIN. */
export async function updateEnabledReportTypes(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"]);

  const enabledReportTypes = pickList(fd, "reportTypes", isReportType);
  // Technical exports may all be switched off; a match document may not, or the
  // Reports tab renders empty for every finished match in the tenant.
  if (!enabledReportTypes.some((t) => CORE_REPORT_TYPES.includes(t)))
    return fail("Enable at least one match report (official sheet, scoresheet or match report).");

  await persist(ctx.tenant.id, { enabledReportTypes });
  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "tenant-config.reports",
    entityType: "tenant",
    entityId: ctx.tenant.id,
    summary: `Enabled reports: ${enabledReportTypes.join(", ")}`,
    metadata: { enabledReportTypes },
  });

  revalidateTenant(tenantSlug);
  return ok("Report types saved.");
}

/**
 * Global-admin variant: same two lists, edited from /admin/tenants/[id] where
 * there is no slug in scope and the actor is not a tenant member.
 */
export async function updateTenantConfigAsAdmin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user } = await requireGlobalAdmin();
  const tenantId = str(fd, "tenantId");
  if (!tenantId) return fail("Missing tenant.");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");

  const enabledDisciplines = pickList(fd, "disciplines", isDiscipline);
  const enabledReportTypes = pickList(fd, "reportTypes", isReportType);
  if (enabledDisciplines.length === 0)
    return fail("Enable at least one discipline.");
  if (!enabledReportTypes.some((t) => CORE_REPORT_TYPES.includes(t)))
    return fail("Enable at least one match report.");

  await persist(tenantId, { enabledDisciplines, enabledReportTypes });
  await recordAudit({
    tenantId,
    actor: { userId: user.id, email: user.email },
    action: "tenant-config.update",
    entityType: "tenant",
    entityId: tenantId,
    summary: "Updated tenant configuration (global admin)",
    metadata: { enabledDisciplines, enabledReportTypes },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidateTenant(tenant.slug);
  return ok("Configuration saved.");
}
