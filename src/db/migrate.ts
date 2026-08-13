// Applies generated SQL migrations to the database. Used for production
// (never `drizzle-kit push`).
//
//   npm run db:migrate              → the schema named by DB_SCHEMA (default public)
//   npm run db:migrate -- --env homolog
//   npm run db:migrate -- --env prod
//
// Production and homologation are two schemas in ONE database (spec/28), so
// each keeps its OWN migration journal — otherwise migrating one would mark the
// other's migrations as already applied and skip them forever.
//
// Uses a direct/session connection (not the transaction pooler) with a single
// connection, as recommended by Drizzle's migrator.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { searchPathFor, type DbSchema } from "./env";

/**
 * `--env homolog|prod`. Deliberately REQUIRED, with no default.
 *
 * Before the schema split, `db:migrate` unambiguously meant production. Now
 * that local shells default to `DB_SCHEMA=homolog`, inheriting that default
 * here would make the old command quietly migrate the clone while the operator
 * believed production was done — the failure would only surface at the next
 * promote. An explicit flag costs six keystrokes and removes the ambiguity.
 */
function targetSchema(): DbSchema {
  const i = process.argv.indexOf("--env");
  const arg = i >= 0 ? process.argv[i + 1] : undefined;
  if (arg === "homolog") return "homolog";
  if (arg === "prod" || arg === "public") return "public";
  if (arg) throw new Error(`--env must be homolog|prod — got "${arg}"`);
  throw new Error(
    "Refusing to guess which tables to migrate.\n" +
      "  npm run db:migrate:homolog   → the homologation clone\n" +
      "  npm run db:migrate:prod      → PRODUCTION tables",
  );
}

// No top-level await — tsx runs this file as CJS (no "type": "module").
async function main() {
  const schema = targetSchema();
  // Migrations want the session pooler (port 5432); fall back to the runtime
  // URL so a one-off run still works if only that is configured.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const searchPath = searchPathFor(schema);
  const sql = postgres(url, {
    max: 1,
    ...(searchPath ? { connection: { search_path: searchPath } } : {}),
  } as never);

  // The target schema must already exist (the clone script creates `homolog`);
  // creating it here would silently produce an empty database on a typo.
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    select exists (select 1 from information_schema.schemata where schema_name = ${schema}) as exists`;
  if (!exists) {
    throw new Error(
      `schema "${schema}" does not exist — run scripts/clone-prod-to-homolog.ts first`,
    );
  }

  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: "./src/db/migrations",
    // Drizzle defaults to `drizzle.__drizzle_migrations`; give homolog its own
    // so the two schemas track their history independently.
    migrationsSchema: schema === "public" ? "drizzle" : "drizzle_homolog",
    migrationsTable: "__drizzle_migrations",
  });
  await sql.end();
  console.log(`✓ Migrations applied to schema "${schema}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
