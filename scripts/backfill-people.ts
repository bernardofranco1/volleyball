// Backfill the people registry from the data that predates it (spec/24 §2.3/§2.4).
//
// Run once per environment, after migration 0010 and before the contract
// migration that makes the person links NOT NULL:
//
//   npx tsx --env-file=.env.local scripts/backfill-people.ts [--dry-run]
//
// Idempotent: every row that already has a person_id is skipped, so a partial or
// interrupted run can simply be repeated.
//
// Deliberately NO fuzzy matching for players. Two roster rows with the same name
// in different competitions become two people. Merging humans is a decision with
// consequences — the wrong merge silently rewrites history on signed scoresheets
// — so it belongs in a reviewed tool, not in a migration script. (VIS ships
// MovePlayerReferences for exactly this reason.) Officials ARE grouped by exact
// name within a tenant, because an official row IS just a typed name and the
// same name on twenty matches was always meant to be one person.
import { isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchOfficials, people, personRoles, players } from "@/db/schema";
import { newId } from "@/lib/id";
import { placeholderEmail } from "@/lib/people-domain";

const DRY = process.argv.includes("--dry-run");

/** Officials roles that describe a referee rather than a table official. */
const REFEREE_ROLES = new Set([
  "FIRST_REFEREE",
  "SECOND_REFEREE",
  "THIRD_REFEREE",
  "CHALLENGE_REFEREE",
  // Line judges have no VIS entity either; treat them as referees (spec/24 A3).
  "LINE_JUDGE_1",
  "LINE_JUDGE_2",
  "LINE_JUDGE_3",
  "LINE_JUDGE_4",
]);

/** Split a stored full name into first/last without inventing a surname. */
function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

async function ensureRole(
  personId: string,
  tenantId: string,
  role: "PLAYER" | "REFEREE" | "COACH" | "SCORER",
): Promise<void> {
  await db
    .insert(personRoles)
    .values({ id: newId("prole"), personId, tenantId, role })
    .onConflictDoNothing();
}

async function backfillPlayers(): Promise<number> {
  const rows = await db
    .select({
      id: players.id,
      tenantId: players.tenantId,
      firstName: players.firstName,
      lastName: players.lastName,
      fullName: players.fullName,
    })
    .from(players)
    .where(isNull(players.personId));

  console.log(`players without a person: ${rows.length}`);
  if (DRY || rows.length === 0) return rows.length;

  for (const r of rows) {
    const split = splitName(r.fullName);
    const personId = newId("per");
    await db.insert(people).values({
      id: personId,
      tenantId: r.tenantId,
      firstName: r.firstName ?? split.first,
      lastName: r.lastName ?? split.last,
      // The roster's full name is what appeared on sheets and boards, so it is
      // the shirt/display label. It is NOT copied into lastName.
      displayName: r.fullName,
    });
    await ensureRole(personId, r.tenantId, "PLAYER");
    await db
      .update(players)
      .set({ personId })
      .where(sql`${players.id} = ${r.id}`);
  }
  return rows.length;
}

async function backfillOfficials(): Promise<number> {
  const rows = await db
    .select({
      id: matchOfficials.id,
      tenantId: matchOfficials.tenantId,
      role: matchOfficials.role,
      name: matchOfficials.name,
      country: matchOfficials.country,
      level: matchOfficials.level,
    })
    .from(matchOfficials)
    .where(isNull(matchOfficials.personId));

  console.log(`match_officials without a person: ${rows.length}`);
  if (DRY || rows.length === 0) return rows.length;

  // One person per (tenant, normalised name) — the same official across matches.
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.tenantId}::${r.name.trim().toLowerCase()}`;
    let personId = byKey.get(key);
    if (!personId) {
      const split = splitName(r.name);
      personId = newId("per");
      await db.insert(people).values({
        id: personId,
        tenantId: r.tenantId,
        firstName: split.first,
        lastName: split.last,
        displayName: r.name.trim(),
        federationCode: r.country ?? null,
        refereeLevel: r.level ?? null,
      });
      byKey.set(key, personId);
    }
    await ensureRole(
      personId,
      r.tenantId,
      REFEREE_ROLES.has(r.role) ? "REFEREE" : "SCORER",
    );
    await db
      .update(matchOfficials)
      .set({ personId })
      .where(sql`${matchOfficials.id} = ${r.id}`);
  }
  console.log(`  → ${byKey.size} distinct officials`);
  return rows.length;
}

/**
 * Give people without an email a placeholder, so the identity field is exercised
 * in dev/demo data (`--placeholder-emails`).
 *
 * Opt-in and never for production: an address at a domain that does not exist is
 * fine for tests, but `people.email` is the strongest duplicate signal, so filling
 * it with fabricated values in real data would make every person look distinct
 * from their true duplicate. `.invalid` is reserved by RFC 2606 and cannot
 * receive mail, which matters because this app really does send email.
 */
async function fillPlaceholderEmails(): Promise<number> {
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(isNull(people.email));
  console.log(`people without an email: ${rows.length}`);
  if (DRY || rows.length === 0) return rows.length;
  for (const r of rows) {
    await db
      .update(people)
      .set({ email: placeholderEmail(r.id) })
      .where(sql`${people.id} = ${r.id}`);
  }
  return rows.length;
}

async function main() {
  if (DRY) console.log("DRY RUN — counting only, nothing written\n");
  const p = await backfillPlayers();
  const o = await backfillOfficials();
  if (process.argv.includes("--placeholder-emails")) {
    const e = await fillPlaceholderEmails();
    console.log(
      DRY
        ? `Would set ${e} placeholder email(s).`
        : `✓ Set ${e} placeholder email(s) (@example.invalid — undeliverable by design).`,
    );
  }
  console.log(
    DRY
      ? `\nWould create people for ${p} roster rows and ${o} officials rows.`
      : `\n✓ Linked ${p} roster rows and ${o} officials rows to people.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
