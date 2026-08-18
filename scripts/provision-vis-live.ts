// Provisioning for the VIS-fed live scoreboard (spec/34): the "Live Events"
// tenant plus three competitions linked to FIVB VIS tournaments — the Boys'
// U17 World Championship (dress rehearsal) and the two AVC Asian
// Championships. These competitions hold NO matches here; they exist to give
// the read-only VIS boards a tenant, branding, and a `vis_tournament_no`.
//
// Dry-run by default — prints exactly what it would write and touches nothing.
//   npx tsx --env-file=.env.local scripts/provision-vis-live.ts             (homolog)
//   npx tsx --env-file=.env.local scripts/provision-vis-live.ts --execute
// PRODUCTION (go-live step 3 in spec/34 — needs migration 0023 applied first):
//   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/provision-vis-live.ts --execute
//
// Idempotent: tenant converges on slug, competitions on their stable ids.
// Existing TENANT_ADMINs of the demo tenant are granted the same role here so
// the usual accounts can see the new tenant without a /admin round-trip.
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  competitions,
  tenantConfig,
  tenants,
  userTenantRoles,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/id";
import { recordAudit } from "../src/lib/audit";

const TENANT = {
  slug: "live-events", // immutable after creation (URLs on venue TVs)
  name: "Live Events",
};

// City/dates/venues verified against VIS on 2026-08-18 (GetVolleyTournament).
const COMPETITIONS = [
  {
    id: "comp_vis_1670",
    visTournamentNo: 1670,
    name: "FIVB Boys' U17 World Championship 2026",
    gender: "MEN" as const,
    category: "YOUTH" as const,
    city: "Doha",
    country: "Qatar",
    timezone: "Asia/Qatar",
    startDate: "2026-08-19",
    endDate: "2026-08-29",
  },
  {
    id: "comp_vis_1766",
    visTournamentNo: 1766,
    name: "AVC Women's Asian Championship 2026",
    gender: "WOMEN" as const,
    category: "SENIOR" as const,
    city: "Tianjin",
    country: "China",
    timezone: "Asia/Shanghai",
    startDate: "2026-08-21",
    endDate: "2026-08-30",
  },
  {
    id: "comp_vis_1765",
    visTournamentNo: 1765,
    name: "AVC Men's Asian Championship 2026",
    gender: "MEN" as const,
    category: "SENIOR" as const,
    city: "Fukuoka",
    country: "Japan",
    timezone: "Asia/Tokyo",
    startDate: "2026-09-04",
    endDate: "2026-09-13",
  },
];

const execute = process.argv.includes("--execute");

async function main() {
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

  console.log(`${execute ? "APPLYING" : "DRY RUN (pass --execute to apply)"}  schema: ${process.env.DB_SCHEMA ?? "homolog (env default)"}`);
  console.log(existing[0] ? `  tenant: reuse ${tenantId}` : `  tenant: create ${tenantId}`);
  console.log(`  slug:   ${TENANT.slug}  name: ${TENANT.name}  disciplines: INDOOR`);
  for (const c of COMPETITIONS)
    console.log(`  comp:   ${c.id} → VIS ${c.visTournamentNo}  ${c.name} (${c.city}, ${c.startDate}→${c.endDate})`);
  if (!execute) return;

  await db
    .insert(tenants)
    .values({ id: tenantId, slug: TENANT.slug, name: TENANT.name })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: TENANT.name } });

  // Indoor only — these boards serve indoor events; readers fall back to
  // "all" on an empty list, so restricting means storing exactly this one.
  await db
    .insert(tenantConfig)
    .values({ tenantId, enabledDisciplines: ["INDOOR"] })
    .onConflictDoUpdate({
      target: tenantConfig.tenantId,
      set: { enabledDisciplines: ["INDOOR"], updatedAt: new Date() },
    });

  for (const c of COMPETITIONS) {
    await db
      .insert(competitions)
      .values({
        id: c.id,
        tenantId,
        name: c.name,
        discipline: "INDOOR",
        gender: c.gender,
        category: c.category,
        city: c.city,
        country: c.country,
        timezone: c.timezone,
        startDate: c.startDate,
        endDate: c.endDate,
        visTournamentNo: c.visTournamentNo,
        status: "ACTIVE",
      })
      .onConflictDoUpdate({
        target: competitions.id,
        set: {
          name: c.name,
          gender: c.gender,
          category: c.category,
          city: c.city,
          country: c.country,
          timezone: c.timezone,
          startDate: c.startDate,
          endDate: c.endDate,
          visTournamentNo: c.visTournamentNo,
          status: "ACTIVE",
        },
      });
  }

  // Give existing demo-tenant admins the same role here (idempotent via the
  // (userId, tenantId, role) unique — onConflictDoNothing).
  const demoAdmins = await db
    .select({ userId: userTenantRoles.userId, email: users.email })
    .from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(eq(userTenantRoles.role, "TENANT_ADMIN"));
  const seen = new Set<string>();
  for (const a of demoAdmins) {
    if (seen.has(a.userId)) continue;
    seen.add(a.userId);
    await db
      .insert(userTenantRoles)
      .values({ id: newId("role"), userId: a.userId, tenantId, role: "TENANT_ADMIN" })
      .onConflictDoNothing();
    console.log(`  admin:  ${a.email}`);
  }

  await recordAudit({
    tenantId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Provisioned '${TENANT.name}' + 3 VIS-linked competitions via scripts/provision-vis-live.ts`,
  });

  const check = await db
    .select({ id: competitions.id, vis: competitions.visTournamentNo })
    .from(competitions)
    .where(inArray(competitions.id, COMPETITIONS.map((c) => c.id)));
  console.log(`✓ tenant ready: /t/${TENANT.slug}`);
  for (const r of check) console.log(`✓ ${r.id} → VIS ${r.vis}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
