// Phase 1 seed: the single foundation tenant (see spec/12-BUILD-ORDER.md).
// The full multi-competition seed (spec/13-SEED-DATA.md) lands in Phase 10.
//
// Run with: `npm run db:seed`
//
// Optionally grants the first TENANT_ADMIN: set SEED_ADMIN_EMAIL and
// SEED_ADMIN_USER_ID (the Supabase Auth user's uuid, found after sign-up) in
// .env.local before running.
import { eq } from "drizzle-orm";
import { db } from "./index";
import { tenants, tenantBranding, users, userTenantRoles } from "./schema";
import { newId } from "../lib/id";

const TENANT = {
  id: "tenant_fivb_demo",
  slug: "fivb-demo",
  name: "FIVB Demo",
  // FIVB brand colours (blue / gold) — see spec/13-SEED-DATA.md.
  primaryColor: "#0047AB",
  secondaryColor: "#FFD700",
};

async function seed() {
  // Tenant (idempotent on slug).
  await db
    .insert(tenants)
    .values({ id: TENANT.id, slug: TENANT.slug, name: TENANT.name })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { name: TENANT.name },
    });

  // Branding (idempotent on tenantId pk).
  await db
    .insert(tenantBranding)
    .values({
      tenantId: TENANT.id,
      primaryColor: TENANT.primaryColor,
      secondaryColor: TENANT.secondaryColor,
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        primaryColor: TENANT.primaryColor,
        secondaryColor: TENANT.secondaryColor,
      },
    });

  console.log(`✓ Seeded tenant '${TENANT.slug}' (${TENANT.name})`);

  // First admin (optional).
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminUserId = process.env.SEED_ADMIN_USER_ID;

  if (adminEmail && adminUserId) {
    await db
      .insert(users)
      .values({ id: adminUserId, email: adminEmail, name: "Admin" })
      .onConflictDoUpdate({ target: users.id, set: { email: adminEmail } });

    const existing = await db
      .select({ id: userTenantRoles.id })
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, adminUserId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(userTenantRoles).values({
        id: newId("role"),
        userId: adminUserId,
        tenantId: TENANT.id,
        role: "TENANT_ADMIN",
      });
    }
    console.log(`✓ Granted TENANT_ADMIN to ${adminEmail}`);
  } else {
    console.log(
      "ℹ Set SEED_ADMIN_EMAIL + SEED_ADMIN_USER_ID to grant the first admin.",
    );
  }

  console.log("✓ Seed complete");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
