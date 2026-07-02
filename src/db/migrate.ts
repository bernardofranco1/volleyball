// Applies generated SQL migrations to the database. Used for production
// (never `drizzle-kit push`). Run with: `npm run db:migrate`
//
// Uses a direct connection (not the transaction pooler) with a single
// connection, as recommended by Drizzle's migrator.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required to run migrations");
}

// No top-level await — tsx runs this file as CJS (no "type": "module").
async function main() {
  const sql = postgres(url!, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await sql.end();
  console.log("✓ Migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
