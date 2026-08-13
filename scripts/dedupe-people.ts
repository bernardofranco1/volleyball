/**
 * Merge duplicate people within a tenant (spec/25 dedupe, applied in bulk).
 *
 * The LNA seed used to insert a fresh `people` row for every officials slot of
 * every match, so one referee who worked eight matches became eight people.
 * The seed is fixed; this repairs the rows already in the database.
 *
 * Grouping key is (lower(first name), lower(last name)) — deliberately the
 * narrowest of spec/25's signals. Email is a per-row placeholder here and VIS
 * numbers are unset, so name is all there is; anything less exact risks merging
 * two different humans, which is not reversible in any useful sense.
 *
 * The survivor is the OLDEST row (stable, and the one most likely referenced by
 * anything created early). Losers keep their history: links move, roles are
 * unioned, identity keys are freed and the row is soft-deleted with a note —
 * exactly what the mergePeople server action does for a single pair.
 *
 *   npx tsx --env-file=.env.local scripts/dedupe-people.ts <tenant-slug>
 *   npx tsx --env-file=.env.local scripts/dedupe-people.ts <tenant-slug> --execute
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, dbTx } from "@/db";
import {
  matchOfficials,
  people,
  personRoles,
  players,
  teamStaff,
  tenants,
} from "@/db/schema";
import { newId } from "@/lib/id";

const slug = process.argv[2];
const execute = process.argv.includes("--execute");

interface Group {
  key: string;
  survivor: { id: string; label: string };
  losers: { id: string; label: string }[];
}

async function main() {
  if (!slug) throw new Error("usage: dedupe-people.ts <tenant-slug> [--execute]");
  const tenant = (
    await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
  )[0];
  if (!tenant) throw new Error(`tenant '${slug}' not found`);

  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      jerseyName: people.jerseyName,
      createdAt: people.createdAt,
    })
    .from(people)
    .where(and(eq(people.tenantId, tenant.id), isNull(people.deletedAt)))
    .orderBy(asc(people.createdAt), asc(people.id));

  const byName = new Map<string, typeof rows>();
  for (const r of rows) {
    // A person with no surname can't be matched on name alone — leave them be.
    if (!r.firstName || !r.lastName) continue;
    const key = `${r.firstName.trim().toLowerCase()}|${r.lastName.trim().toLowerCase()}`;
    byName.set(key, [...(byName.get(key) ?? []), r]);
  }

  const label = (r: (typeof rows)[number]) =>
    `${r.lastName}, ${r.firstName} (${r.id})`;
  const groups: Group[] = [];
  for (const [key, list] of byName) {
    if (list.length < 2) continue;
    groups.push({
      key,
      survivor: { id: list[0].id, label: label(list[0]) },
      losers: list.slice(1).map((r) => ({ id: r.id, label: label(r) })),
    });
  }

  console.log(execute ? "APPLYING" : "DRY RUN (pass --execute to apply)");
  console.log(`  tenant:     ${tenant.name} (${tenant.id})`);
  console.log(`  people:     ${rows.length} live rows`);
  console.log(`  duplicated: ${groups.length} name(s)`);
  console.log(
    `  to merge:   ${groups.reduce((n, g) => n + g.losers.length, 0)} row(s) away`,
  );

  // Refuse any merge that would put one person on the same roster twice — the
  // same guard the interactive action applies, and the one case where merging
  // would silently lose a jersey number.
  const blocked: string[] = [];
  for (const g of groups) {
    const ids = [g.survivor.id, ...g.losers.map((l) => l.id)];
    const spots = await db
      .select({ personId: players.personId, teamId: players.teamId })
      .from(players)
      .where(and(eq(players.tenantId, tenant.id), inArray(players.personId, ids)));
    const teams = new Set<string>();
    for (const s of spots) {
      if (teams.has(s.teamId)) {
        blocked.push(`${g.key} — two roster spots on team ${s.teamId}`);
        break;
      }
      teams.add(s.teamId);
    }
  }
  if (blocked.length > 0) {
    console.log("\n  BLOCKED (same-roster clash, skipped):");
    for (const b of blocked) console.log(`   - ${b}`);
  }
  const runnable = groups.filter(
    (g) => !blocked.some((b) => b.startsWith(`${g.key} `)),
  );

  for (const g of runnable) {
    console.log(`\n  ${g.survivor.label}  ← ${g.losers.length} duplicate(s)`);
  }
  if (!execute) return;

  let movedOfficials = 0;
  let movedRosters = 0;
  let movedStaff = 0;
  let merged = 0;

  for (const g of runnable) {
    for (const loser of g.losers) {
      await dbTx.transaction(async (tx) => {
        const r1 = await tx
          .update(players)
          .set({ personId: g.survivor.id })
          .where(eq(players.personId, loser.id))
          .returning({ id: players.id });
        // Officials keep their printed snapshot; only the link moves.
        const r2 = await tx
          .update(matchOfficials)
          .set({ personId: g.survivor.id })
          .where(eq(matchOfficials.personId, loser.id))
          .returning({ id: matchOfficials.id });
        const r3 = await tx
          .update(teamStaff)
          .set({ personId: g.survivor.id })
          .where(eq(teamStaff.personId, loser.id))
          .returning({ id: teamStaff.id });

        const srcRoles = await tx
          .select({ role: personRoles.role })
          .from(personRoles)
          .where(eq(personRoles.personId, loser.id));
        for (const { role } of srcRoles) {
          await tx
            .insert(personRoles)
            .values({
              id: newId("prole"),
              personId: g.survivor.id,
              tenantId: tenant.id,
              role,
            })
            .onConflictDoNothing();
        }
        await tx.delete(personRoles).where(eq(personRoles.personId, loser.id));

        // Free the identity keys before soft-deleting, so the
        // unique-when-present indexes don't keep a dead row reserving an email
        // or a VIS number.
        await tx
          .update(people)
          .set({
            email: null,
            visPersonNo: null,
            userId: null,
            deletedAt: new Date(),
            notes: `Merged into ${g.survivor.id} by scripts/dedupe-people.ts`,
          })
          .where(eq(people.id, loser.id));

        movedRosters += r1.length;
        movedOfficials += r2.length;
        movedStaff += r3.length;
        merged += 1;
      });
    }
  }

  console.log(
    `\nDONE — merged ${merged} row(s); moved ${movedOfficials} officials slot(s), ${movedRosters} roster spot(s), ${movedStaff} staff row(s).`,
  );
}

// No top-level await: tsx compiles these scripts to CJS.
void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
