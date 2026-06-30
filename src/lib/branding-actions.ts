"use server";

import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/db";
import { tenantBranding } from "@/db/schema";
import { requireRole } from "@/lib/authz";
import { COURT_VARS } from "@/lib/branding";
import { recordAudit } from "@/lib/audit";
import { fail, OK, type FormState } from "@/lib/action-state";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Update a tenant's branding (colours, logo, font, court overrides). TENANT_ADMIN. */
export async function updateBranding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"]);

  const primaryColor = str(fd, "primaryColor") || "#0066cc";
  const secondaryColor = str(fd, "secondaryColor") || "#ffffff";
  const logoUrl = str(fd, "logoUrl") || null;
  const fontFamily = str(fd, "fontFamily") || null;

  const overrides: Record<string, string> = {};
  for (const { key } of COURT_VARS) {
    const v = str(fd, key);
    if (v) overrides[key] = v;
  }
  const courtColorOverrides = Object.keys(overrides).length ? overrides : null;

  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primaryColor))
    return fail("Primary colour must be a hex value like #0047AB.");

  await db
    .insert(tenantBranding)
    .values({
      tenantId: ctx.tenant.id,
      primaryColor,
      secondaryColor,
      logoUrl,
      fontFamily,
      courtColorOverrides,
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        primaryColor,
        secondaryColor,
        logoUrl,
        fontFamily,
        courtColorOverrides,
      },
    });

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "branding.update",
    entityType: "tenant",
    entityId: ctx.tenant.id,
    summary: "Updated tenant branding",
    metadata: { primaryColor, hasLogo: Boolean(logoUrl) },
  });

  revalidatePath(`/t/${tenantSlug}`, "layout");
  updateTag(`tenant:${tenantSlug}`);
  return OK;
}
