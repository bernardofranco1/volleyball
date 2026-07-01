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

// max/idle_timeout keep N warm serverless instances from pinning the pooler's
// client-connection budget: 5 sockets per instance is plenty (queries are
// short), and idle sockets are released after 20s instead of held forever.
const client = postgres(connectionString, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
