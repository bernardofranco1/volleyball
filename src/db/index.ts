import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Supabase pooler (Transaction mode, port 6543) is the runtime connection for
// all serverless routes. `prepare: false` is required because PgBouncer in
// transaction mode does not support prepared statements.
//
// A placeholder URL keeps `import` side-effect-free when DATABASE_URL is unset
// (e.g. during `next build` on a machine without DB access). `postgres()` is
// lazy — it only opens a socket on the first query — so nothing connects until
// a query actually runs.
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder";

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
