// One-off provisioning: VBC Cheseaux tenant with club branding.
//
// Dry-run by default — prints exactly what it would write and touches nothing.
//   npx tsx --env-file=.env.local scripts/provision-vbc-cheseaux.ts
// Apply:
//   npx tsx --env-file=.env.local scripts/provision-vbc-cheseaux.ts --execute
//
// Needs DATABASE_URL plus NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// (for the logo upload to the public `branding` bucket). Idempotent: re-running
// converges the same slug/branding instead of duplicating (mirrors src/db/seed.ts);
// the logo object path is content-hashed, so an unchanged file re-uploads in place.
//
// Cache note: a fresh slug has no `tenant:<slug>` cache entry to invalidate, so
// no revalidation is needed. If this script is ever reused to CHANGE an existing
// tenant's branding, the old entry can persist for up to 60s (tenant.ts revalidate).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { tenants, tenantBranding, tenantConfig } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { recordAudit } from "../src/lib/audit";
import { createSupabaseAdminClient } from "../src/lib/supabase-admin";

const TENANT = {
  slug: "vbc-cheseaux", // immutable after creation (printed QR codes)
  name: "VBC Cheseaux",
  title: "VBC Cheseaux", // header wordmark + browser tab title
  // Club blue from the logo (#03aee3), deepened ~8% so all three of the app's
  // own contrast checks (BrandPreview: vs dark shell, vs light shell, text-on-
  // primary) clear the 3:1 WCAG threshold. Secondary is text-on-primary.
  primaryColor: "#0295c9",
  secondaryColor: "#ffffff",
  // subdomain intentionally null — inert until the root domain exists anyway
  // The club plays indoor only; readers fall back to "all" on an empty list,
  // so restricting means storing exactly this one discipline.
  enabledDisciplines: ["INDOOR"],
};

// Round club badge: white disc + red ring, legible on light AND dark shells.
// scripts/assets/vbc-cheseaux-wordmark-dark-bg.png is the wide official
// wordmark — white lettering, dark backgrounds only — swap it in here if the
// header ever goes permanently dark.
const LOGO_FILE = new URL("./assets/vbc-cheseaux-badge.png", import.meta.url);
// Federation logo for the top-right box of official e-scoresheets (PNG only —
// pdfkit cannot embed WebP/SVG).
const SHEET_LOGO_FILE = new URL("./assets/swiss-volley.png", import.meta.url);

const execute = process.argv.includes("--execute");

async function main() {
  const logo = readFileSync(LOGO_FILE);
  if (logo.length > 1024 * 1024) throw new Error("logo exceeds the 1MB app limit");
  // PNG magic bytes — same gate updateBranding enforces (branding-actions.ts)
  if (!(logo[0] === 0x89 && logo[1] === 0x50 && logo[2] === 0x4e && logo[3] === 0x47)) {
    throw new Error("logo is not a PNG");
  }
  const hash8 = createHash("sha256").update(logo).digest("hex").slice(0, 8);

  const sheetLogo = readFileSync(SHEET_LOGO_FILE);
  if (sheetLogo.length > 1024 * 1024) throw new Error("sheet logo exceeds the 1MB app limit");
  if (!(sheetLogo[0] === 0x89 && sheetLogo[1] === 0x50 && sheetLogo[2] === 0x4e && sheetLogo[3] === 0x47)) {
    throw new Error("sheet logo is not a PNG");
  }
  const sheetHash8 = createHash("sha256").update(sheetLogo).digest("hex").slice(0, 8);

  const existing = await db
    .select({ id: tenants.id, deletedAt: tenants.deletedAt })
    .from(tenants)
    .where(eq(tenants.slug, TENANT.slug))
    .limit(1);
  if (existing[0]?.deletedAt) {
    throw new Error(
      `tenant '${TENANT.slug}' exists but is soft-deleted (${existing[0].id}) — restore or purge it via /admin first`,
    );
  }
  const tenantId = existing[0]?.id ?? newId("tnt");
  // Path convention from branding-actions.ts: <tenantId>/logo-<sha256[0:8]>.<ext>
  const logoPath = `${tenantId}/logo-${hash8}.png`;
  const sheetLogoPath = `${tenantId}/scoresheet-${sheetHash8}.png`;

  console.log(`${execute ? "APPLYING" : "DRY RUN (pass --execute to apply)"}`);
  console.log(existing[0] ? `  tenant:   reuse ${tenantId} (slug exists)` : `  tenant:   create ${tenantId}`);
  console.log(`  slug:     ${TENANT.slug}   name/title: ${TENANT.name}`);
  console.log(`  colors:   primary ${TENANT.primaryColor}  text-on-primary ${TENANT.secondaryColor}`);
  console.log(`  logo:     branding/${logoPath} (${logo.length} bytes)`);
  console.log(`  sheet:    branding/${sheetLogoPath} (${sheetLogo.length} bytes, Swiss Volley)`);
  console.log(`  config:   disciplines ${TENANT.enabledDisciplines.join(", ")} (reports: all)`);
  if (!execute) return;

  // 1. Logo first — so the branding row can only ever reference a live object.
  const admin = createSupabaseAdminClient();
  const { error: upErr } = await admin.storage
    .from("branding")
    .upload(logoPath, logo, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`logo upload failed: ${upErr.message}`);
  const logoUrl = admin.storage.from("branding").getPublicUrl(logoPath).data.publicUrl;

  const { error: sheetErr } = await admin.storage
    .from("branding")
    .upload(sheetLogoPath, sheetLogo, { contentType: "image/png", upsert: true });
  if (sheetErr) throw new Error(`sheet logo upload failed: ${sheetErr.message}`);
  const scoresheetLogoUrl = admin.storage
    .from("branding")
    .getPublicUrl(sheetLogoPath).data.publicUrl;

  // 2. Tenant (idempotent on slug, like src/db/seed.ts).
  await db
    .insert(tenants)
    .values({ id: tenantId, slug: TENANT.slug, name: TENANT.name })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: TENANT.name } });

  // 3. Branding (idempotent on the tenantId pk). fontFamily / courtColorOverrides
  // stay untouched so a later admin-UI edit isn't clobbered by a re-run.
  await db
    .insert(tenantBranding)
    .values({
      tenantId,
      title: TENANT.title,
      primaryColor: TENANT.primaryColor,
      secondaryColor: TENANT.secondaryColor,
      logoUrl,
      scoresheetLogoUrl,
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        title: TENANT.title,
        primaryColor: TENANT.primaryColor,
        secondaryColor: TENANT.secondaryColor,
        logoUrl,
        scoresheetLogoUrl,
      },
    });

  // 4. Config: indoor only. enabledReportTypes stays NULL → all report types.
  await db
    .insert(tenantConfig)
    .values({ tenantId, enabledDisciplines: TENANT.enabledDisciplines })
    .onConflictDoUpdate({
      target: tenantConfig.tenantId,
      set: { enabledDisciplines: TENANT.enabledDisciplines, updatedAt: new Date() },
    });

  // Parity with the admin-console action (best-effort, never throws).
  await recordAudit({
    tenantId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Provisioned '${TENANT.name}' via scripts/provision-vbc-cheseaux.ts`,
  });

  console.log(`✓ tenant ready: /t/${TENANT.slug}  logo: ${logoUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
