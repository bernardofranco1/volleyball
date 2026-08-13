/**
 * Refresh the homologation tables from production (spec/28).
 *
 * Production and homologation are two schemas in ONE database: `public` holds
 * production, `homolog` holds a clone of it that candidates read and write
 * while they are being validated. This script rebuilds that clone.
 *
 *   npx tsx --env-file=.env.local scripts/clone-prod-to-homolog.ts
 *   npx tsx --env-file=.env.local scripts/clone-prod-to-homolog.ts --execute
 *   …                                                              --execute --keep-emails
 *
 * What it does, in one transaction:
 *   1. drop schema homolog cascade; create schema homolog
 *   2. per public table: CREATE TABLE homolog.t (LIKE public.t INCLUDING ALL)
 *      — carries defaults, checks, not-null and indexes, but NOT foreign keys
 *   3. copy every row
 *   4. re-create the foreign keys, re-pointed at homolog
 *   5. copy production's migration journal into drizzle_homolog, so a
 *      candidate's `db:migrate --env homolog` applies exactly its own delta
 *   6. scrub email addresses (unless --keep-emails) so homologation can never
 *      mail a real person
 *
 * It only ever writes to `homolog`. `public` is read-only here, and the whole
 * thing runs inside one transaction — a failure leaves no half-built clone.
 */
import postgres from "postgres";

const execute = process.argv.includes("--execute");
const keepEmails = process.argv.includes("--keep-emails");

/** Addresses that must keep working in homologation (our own logins). */
const EMAIL_ALLOWLIST = [
  "bernardo.franco@fivb.com",
  "bernardofranco1@gmail.com",
  "admin@volleyball-demo.app",
];

const SRC = "public";
const DST = "homolog";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL required");
  // Session/direct connection: this is DDL-heavy and wants one stable session.
  const sql = postgres(url, { max: 1, connect_timeout: 15 });

  // ── survey what we are about to copy ──────────────────────────────────
  const tables = await sql<{ name: string }[]>`
    select table_name as name
    from information_schema.tables
    where table_schema = ${SRC} and table_type = 'BASE TABLE'
    order by table_name`;

  const counts = new Map<string, number>();
  for (const t of tables) {
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from ${sql(SRC)}.${sql(t.name)}`;
    counts.set(t.name, Number(n));
  }

  const fks = await sql<{ table: string; name: string; def: string }[]>`
    select rel.relname as table, con.conname as name,
           pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = ${SRC} and con.contype = 'f'`;

  const emailCols = await sql<{ table: string; column: string }[]>`
    select table_name as table, column_name as column
    from information_schema.columns
    where table_schema = ${SRC} and column_name in ('email', 'actor_email', 'signer_name')
      and column_name <> 'signer_name'`;

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(execute ? "APPLYING" : "DRY RUN (pass --execute to apply)");
  console.log(`  source:  ${SRC} — ${tables.length} tables, ${total} rows`);
  console.log(`  target:  ${DST} (dropped and rebuilt)`);
  console.log(`  keys:    ${fks.length} foreign keys re-created`);
  console.log(
    `  emails:  ${keepEmails ? "KEPT AS-IS (--keep-emails)" : `scrubbed in ${emailCols.length} column(s), allow-list keeps ${EMAIL_ALLOWLIST.length}`}`,
  );
  for (const t of tables) console.log(`    ${t.name.padEnd(24)} ${counts.get(t.name)}`);
  if (!execute) {
    await sql.end();
    return;
  }

  const started = Date.now();
  await sql.begin(async (tx) => {
    await tx.unsafe(`drop schema if exists ${DST} cascade`);
    await tx.unsafe(`create schema ${DST}`);

    // Structure first, then data, then keys — so table order never matters.
    for (const t of tables) {
      await tx.unsafe(
        `create table ${DST}."${t.name}" (like ${SRC}."${t.name}" including all)`,
      );
    }
    for (const t of tables) {
      await tx.unsafe(
        `insert into ${DST}."${t.name}" select * from ${SRC}."${t.name}"`,
      );
    }
    for (const fk of fks) {
      // pg_get_constraintdef prints "REFERENCES public.other(id)" (or an
      // unqualified name when public is in the search path) — re-point it at
      // the clone so homolog rows never reference production rows.
      const def = fk.def
        .replace(/REFERENCES\s+public\./i, `REFERENCES ${DST}.`)
        .replace(/REFERENCES\s+(?!public\.|homolog\.)"?(\w+)"?/i, `REFERENCES ${DST}."$1"`);
      await tx.unsafe(
        `alter table ${DST}."${fk.table}" add constraint "${fk.name}" ${def}`,
      );
    }

    // Row-level security parity. The app connects as the owner (which bypasses
    // RLS) and PostgREST only exposes `public`, so this is belt-and-braces —
    // but a clone that differs from production in a security setting is a trap
    // waiting for someone.
    for (const t of tables) {
      await tx.unsafe(`alter table ${DST}."${t.name}" enable row level security`);
    }

    // Migration journal: start homolog where production currently stands.
    await tx.unsafe(`create schema if not exists drizzle_homolog`);
    await tx.unsafe(`drop table if exists drizzle_homolog.__drizzle_migrations`);
    await tx.unsafe(
      `create table drizzle_homolog.__drizzle_migrations
         (like drizzle.__drizzle_migrations including all)`,
    );
    await tx.unsafe(
      `insert into drizzle_homolog.__drizzle_migrations
         select * from drizzle.__drizzle_migrations`,
    );

    if (!keepEmails) {
      const allow = EMAIL_ALLOWLIST.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
      for (const c of emailCols) {
        // Deterministic and reversible-looking, so a tester can still tell who
        // is who: alice@club.ch → alice+<rowid>@homolog.invalid is overkill;
        // the local part alone is enough and keeps the column unique-ish.
        await tx.unsafe(
          `update ${DST}."${c.table}"
             set "${c.column}" = split_part("${c.column}", '@', 1) || '@homolog.invalid'
           where "${c.column}" is not null
             and "${c.column}" not in (${allow})
             and "${c.column}" not like '%@homolog.invalid'`,
        );
      }
    }
  });

  // Verify outside the transaction: row parity per table.
  let mismatched = 0;
  for (const t of tables) {
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from ${sql(DST)}.${sql(t.name)}`;
    if (Number(n) !== counts.get(t.name)) {
      console.error(`  ✗ ${t.name}: ${n} rows in ${DST}, ${counts.get(t.name)} in ${SRC}`);
      mismatched++;
    }
  }
  const [{ n: fkCount }] = await sql<{ n: string }[]>`
    select count(*)::text as n
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = ${DST} and con.contype = 'f'`;

  await sql.end();
  console.log(
    `\n${mismatched === 0 ? "✓" : "✗"} cloned ${tables.length} tables / ${total} rows / ${fkCount} foreign keys in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (mismatched > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
