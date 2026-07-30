"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/db";
import { tenantBranding } from "@/db/schema";
import { requireRole } from "@/lib/authz";
import { COURT_VARS } from "@/lib/branding";
import { normalizeHex } from "@/lib/colors";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

/** Public-read bucket for uploaded tenant logos (spec/23 §5.2). */
const BRANDING_BUCKET = "branding";
const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * Sniff the real image type from magic bytes — the browser-supplied MIME type
 * is attacker-controlled. SVG is deliberately not uploadable (script-bearing);
 * an https URL to an external SVG remains possible via the URL field, where
 * it only ever renders inside <img>.
 */
function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return { ext: "png", mime: "image/png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", mime: "image/jpeg" };
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

/** Storage key of a previously uploaded logo, or null for external URLs. */
function uploadedLogoPath(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${BRANDING_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

/** Update a tenant's branding (title, colours, logo, font, court overrides). TENANT_ADMIN. */
export async function updateBranding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"]);

  const title = str(fd, "title") || null;
  if (title && title.length > 60) return fail("Title is too long (max 60 chars).");

  // Every colour is injected into the tenant layout's CSS variables — validate
  // all of them, not just the primary (they'd otherwise break theming or worse).
  const primaryColor = normalizeHex(str(fd, "primaryColor") || "#0066cc");
  if (!primaryColor)
    return fail("Primary colour must be a hex value like #0047AB.");
  const secondaryColor = normalizeHex(str(fd, "secondaryColor") || "#ffffff");
  if (!secondaryColor)
    return fail("Secondary colour must be a hex value like #ffffff.");

  let logoUrl = str(fd, "logoUrl") || null;
  if (logoUrl) {
    try {
      const u = new URL(logoUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      return fail("Logo must be an http(s) URL.");
    }
  }

  // Uploaded file wins over the URL field (spec/23 §5.2).
  const file = fd.get("logoFile");
  let uploadedPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES)
      return fail("Logo file is too large (max 1 MB).");
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind)
      return fail(
        "Logo must be a PNG, JPEG or WebP image. For SVG, host it elsewhere and use the URL field.",
      );
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 8);
    uploadedPath = `${ctx.tenant.id}/logo-${hash}.${kind.ext}`;
    const admin = createSupabaseAdminClient();
    const { error } = await admin.storage
      .from(BRANDING_BUCKET)
      .upload(uploadedPath, buf, { contentType: kind.mime, upsert: true });
    if (error) return fail(`Logo upload failed: ${error.message}`);
    logoUrl = admin.storage.from(BRANDING_BUCKET).getPublicUrl(uploadedPath)
      .data.publicUrl;
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

  // Previous uploaded logo (if any) is deleted after a successful save — but
  // only when it actually changed, and only if it lives in our bucket.
  const prev = (
    await db
      .select({ logoUrl: tenantBranding.logoUrl })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, ctx.tenant.id))
      .limit(1)
  )[0];

  await db
    .insert(tenantBranding)
    .values({
      tenantId: ctx.tenant.id,
      title,
      primaryColor,
      secondaryColor,
      logoUrl,
      fontFamily,
      courtColorOverrides,
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        title,
        primaryColor,
        secondaryColor,
        logoUrl,
        fontFamily,
        courtColorOverrides,
      },
    });

  const stalePath = uploadedLogoPath(prev?.logoUrl ?? null);
  if (stalePath && stalePath !== uploadedPath && logoUrl !== prev?.logoUrl) {
    // Best-effort cleanup; a stray object is harmless.
    const admin = createSupabaseAdminClient();
    await admin.storage.from(BRANDING_BUCKET).remove([stalePath]);
  }

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "branding.update",
    entityType: "tenant",
    entityId: ctx.tenant.id,
    summary: "Updated tenant branding",
    metadata: { primaryColor, hasLogo: Boolean(logoUrl), uploaded: Boolean(uploadedPath) },
  });

  revalidatePath(`/t/${tenantSlug}`, "layout");
  updateTag(`tenant:${tenantSlug}`);
  return ok("Branding saved.");
}
