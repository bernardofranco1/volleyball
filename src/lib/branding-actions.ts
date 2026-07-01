"use server";

import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/db";
import { tenantBranding } from "@/db/schema";
import { requireRole } from "@/lib/authz";
import { COURT_VARS } from "@/lib/branding";
import { normalizeHex } from "@/lib/colors";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

/** Update a tenant's branding (colours, logo, font, court overrides). TENANT_ADMIN. */
export async function updateBranding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"]);

  // Every colour is injected into the tenant layout's CSS variables — validate
  // all of them, not just the primary (they'd otherwise break theming or worse).
  const primaryColor = normalizeHex(str(fd, "primaryColor") || "#0066cc");
  if (!primaryColor)
    return fail("Primary colour must be a hex value like #0047AB.");
  const secondaryColor = normalizeHex(str(fd, "secondaryColor") || "#ffffff");
  if (!secondaryColor)
    return fail("Secondary colour must be a hex value like #ffffff.");

  const logoUrl = str(fd, "logoUrl") || null;
  if (logoUrl) {
    try {
      const u = new URL(logoUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      return fail("Logo must be an http(s) URL.");
    }
  }

  const fontFamily = str(fd, "fontFamily") || null;
  if (fontFamily && !/^[\w\s,'-]{1,100}$/.test(fontFamily))
    return fail("Font family contains unsupported characters.");

  const overrides: Record<string, string> = {};
  for (const { key } of COURT_VARS) {
    const v = str(fd, key);
    if (!v) continue;
    const hex = normalizeHex(v);
    if (!hex) return fail(`Court colour “${key}” must be a hex value.`);
    overrides[key] = hex;
  }
  const courtColorOverrides = Object.keys(overrides).length ? overrides : null;

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
  return ok("Branding saved.");
}
