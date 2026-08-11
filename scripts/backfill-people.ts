// Utility for the people registry (spec/24 §6, spec/25 §2).
//
//   npx tsx --env-file=.env.local scripts/backfill-people.ts --placeholder-emails
//
// The one-time backfill that created a person per roster row and per officials
// name lived here and has already been run in every environment. It is gone now
// because it CANNOT run any more: migration 0012 made players.person_id and
// match_officials.person_id NOT NULL, so an unlinked row is unrepresentable. The
// original logic is in git history at the commit that introduced spec/24 — needed
// only if an environment is restored from a pre-0012 backup, in which case run it
// BEFORE applying 0012.
import { isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { placeholderEmail } from "@/lib/people-domain";

const DRY = process.argv.includes("--dry-run");

/**
 * Give people without an email a placeholder, so the identity field is exercised
 * in dev/demo data (`--placeholder-emails`).
 *
 * Opt-in and never for production: `people.email` is the strongest duplicate
 * signal, so filling it with fabricated values in real data would make every
 * person look distinct from their true duplicate. `.invalid` is reserved by
 * RFC 2606 and cannot receive mail, which matters because this app really does
 * send email.
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
  if (!process.argv.includes("--placeholder-emails")) {
    console.log(
      "Nothing to do. Pass --placeholder-emails to fill dev/demo addresses.",
    );
    process.exit(0);
  }
  const n = await fillPlaceholderEmails();
  console.log(
    DRY
      ? `Would set ${n} placeholder email(s).`
      : `✓ Set ${n} placeholder email(s) (@example.invalid — undeliverable by design).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
