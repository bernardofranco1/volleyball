"use server";

// Tenant lifecycle Server Actions (spec/23 §3.3) — global admin only.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantBranding, tenants } from "@/db/schema";
import { requireGlobalAdmin } from "@/lib/authz";
import { runBackup, TEST_TENANT_SLUG } from "@/lib/backup";
import { getTenantById, hasLiveMatch } from "@/lib/tenant-admin";
import { isValidSubdomain } from "@/lib/subdomain";
import { normalizeHex } from "@/lib/colors";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/** Parse + validate the optional subdomain field ("" → null). */
function parseSubdomain(fd: FormData): { value: string | null } | { error: string } {
  const raw = str(fd, "subdomain").toLowerCase();
  if (!raw) return { value: null };
  if (!isValidSubdomain(raw)) {
    return {
      error:
        "Subdomain must be lowercase letters/digits/hyphens (not starting or ending with a hyphen) and not a reserved name.",
    };
  }
  return { value: raw };
}

/** Create a tenant + its branding row, then jump to its console page. */
export async function createTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user } = await requireGlobalAdmin();

  const name = str(fd, "name");
  if (!name || name.length > 80) return fail("Enter a tenant name (max 80 chars).");

  const slug = str(fd, "slug").toLowerCase();
  if (!SLUG_RE.test(slug))
    return fail(
      "Slug must be lowercase letters/digits/hyphens, 1-50 chars (it becomes part of every URL and cannot be changed later).",
    );

  const sub = parseSubdomain(fd);
  if ("error" in sub) return fail(sub.error);

  const title = str(fd, "title") || null;
  if (title && title.length > 60) return fail("Title is too long (max 60 chars).");

  const primaryColor = normalizeHex(str(fd, "primaryColor") || "#0066cc");
  if (!primaryColor) return fail("Primary colour must be a hex value.");
  const secondaryColor = normalizeHex(str(fd, "secondaryColor") || "#ffffff");
  if (!secondaryColor) return fail("Secondary colour must be a hex value.");

  const tenantId = newId("tnt");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        slug,
        name,
        subdomain: sub.value,
      });
      await tx.insert(tenantBranding).values({
        tenantId,
        title,
        primaryColor,
        secondaryColor,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err))
      return fail("That slug or subdomain is already taken.");
    throw err;
  }

  await recordAudit({
    tenantId,
    actor: { userId: user.id, email: user.email },
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Created tenant “${name}” (${slug})`,
    metadata: { slug, subdomain: sub.value },
  });

  revalidatePath("/admin");
  redirect(`/admin/tenants/${tenantId}?created=1`);
}

/** Rename a tenant / change its subdomain (slug is immutable — printed QRs). */
export async function updateTenantConfig(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user } = await requireGlobalAdmin();
  const tenantId = str(fd, "tenantId");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");

  const name = str(fd, "name");
  if (!name || name.length > 80) return fail("Enter a tenant name (max 80 chars).");

  const sub = parseSubdomain(fd);
  if ("error" in sub) return fail(sub.error);

  try {
    await db
      .update(tenants)
      .set({ name, subdomain: sub.value })
      .where(eq(tenants.id, tenantId));
  } catch (err) {
    if (isUniqueViolation(err)) return fail("That subdomain is already taken.");
    throw err;
  }

  await recordAudit({
    tenantId,
    actor: { userId: user.id, email: user.email },
    action: "tenant.config",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Updated tenant config (name “${name}”, subdomain ${sub.value ?? "—"})`,
  });

  updateTag(`tenant:${tenant.slug}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${tenantId}`);
  return ok("Tenant updated.");
}

/**
 * Soft delete (spec/23 §3.4): type-the-name confirmation → final FULL backup
 * (must succeed) → deleted_at set → every tenant URL goes dark. Restorable for
 * DELETE_GRACE_DAYS via restoreTenant; the daily cron purges after that.
 */
export async function softDeleteTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user } = await requireGlobalAdmin();
  const tenantId = str(fd, "tenantId");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");
  if (tenant.deletedAt) return fail("This tenant is already deleted.");
  if (tenant.slug === TEST_TENANT_SLUG)
    return fail("The Test tenant cannot be deleted.");
  if (str(fd, "confirmName") !== tenant.name)
    return fail("Type the tenant's exact name to confirm deletion.");
  if (await hasLiveMatch(tenantId))
    return fail("A match is LIVE in this tenant — finish or abandon it first.");

  // The final backup is the safety net for the whole lifecycle — hard-fail the
  // deletion if it doesn't complete.
  const backup = await runBackup({ tenantId, kind: "FULL", trigger: "MANUAL" });
  if (!backup.ok)
    return fail(`Final backup failed (${backup.error}) — tenant NOT deleted.`);

  await db
    .update(tenants)
    .set({ deletedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await recordAudit({
    tenantId,
    actor: { userId: user.id, email: user.email },
    action: "tenant.softDelete",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Soft-deleted tenant “${tenant.name}” (final backup ${backup.objectPath})`,
  });

  updateTag(`tenant:${tenant.slug}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${tenantId}`);
  return ok("Tenant deleted. It can be restored from this page for 7 days.");
}

/** Undo a soft delete during the grace period. */
export async function restoreTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user } = await requireGlobalAdmin();
  const tenantId = str(fd, "tenantId");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");
  if (!tenant.deletedAt) return fail("This tenant isn't deleted.");

  await db
    .update(tenants)
    .set({ deletedAt: null })
    .where(eq(tenants.id, tenantId));

  await recordAudit({
    tenantId,
    actor: { userId: user.id, email: user.email },
    action: "tenant.restore",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Restored tenant “${tenant.name}”`,
  });

  updateTag(`tenant:${tenant.slug}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${tenantId}`);
  return ok("Tenant restored.");
}

/** Manual "Back up now" from the console. */
export async function runTenantBackup(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireGlobalAdmin();
  const tenantId = str(fd, "tenantId");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");

  const result = await runBackup({ tenantId, kind: "FULL", trigger: "MANUAL" });
  revalidatePath("/admin/backups");
  revalidatePath(`/admin/tenants/${tenantId}`);
  if (!result.ok) return fail(`Backup failed: ${result.error}`);
  return ok(
    `Backup complete (${((result.sizeBytes ?? 0) / 1024).toFixed(1)} kB).`,
  );
}
