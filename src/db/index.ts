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
// max_pipeline: 0 — NEVER pipeline queries onto a busy connection. Supavisor
// in transaction mode does not support the pipelined wire protocol: a second
// statement sent before the first one's response desyncs the pooler, the
// response never arrives, and the connection wedges FOREVER (every subsequent
// page hangs until the instance dies). Once app concurrency exceeded `max`
// (spec/23's parallel console queries), postgres.js started pipelining and
// production froze — 2026-07-30 incident. With 0, excess queries wait in the
// in-process queue for a free connection, which transaction pooling supports.
// (`max_pipeline` is a real postgres.js option — parsed in its option ints —
// but missing from its TypeScript definitions, hence the assertion.)
const client = postgres(connectionString, {
  prepare: false,
  max: 5,
  max_pipeline: 0,
  idle_timeout: 20,
  connect_timeout: 10,
} as postgres.Options<Record<string, never>>);

export const db = drizzle(client, { schema });
export { schema };
