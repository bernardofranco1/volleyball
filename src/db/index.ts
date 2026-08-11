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

// TWO POOLS, and they are not interchangeable. Read `db` vs `dbTx` below before
// touching either — the split exists because postgres.js cannot serve both needs
// from one pool against Supavisor in transaction mode.
//
// The constraint: Supavisor in transaction mode does not support the pipelined
// wire protocol. A second statement sent before the first one's response desyncs
// the pooler, the response never arrives, and the connection wedges FOREVER
// (every subsequent page hangs until the instance dies). Once app concurrency
// exceeded `max`, postgres.js started pipelining and production froze —
// 2026-07-30 incident. `max_pipeline: 0` is what stops that.
//
// The catch, found 2026-08-11: `max_pipeline: 0` ALSO breaks every transaction.
// postgres.js evaluates the pipeline gate (`sent.length < max_pipeline`) in the
// same `&&` chain that invokes `q.options.onexecute`, and `onexecute` is how
// `sql.begin()` claims its connection. With 0 the chain short-circuits, begin's
// connection is never claimed, and the driver either refuses the BEGIN
// ("UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1") or throws
// on an undefined connection. That silently killed EVERY `dbTx.transaction()` —
// appending a scoring event, creating a competition, saving officials, CSV
// imports, tenant purge. Raising it to 1 revives transactions but re-enables
// depth-2 pipelining, which wedges again under concurrent reads.
//
// So: reads and single-statement writes go through a no-pipelining pool, and
// transactions go through a separate single-connection pool where postgres.js
// permits BEGIN (its guard allows it when `max === 1`). One connection means
// concurrent transactions QUEUE for it rather than pipelining onto it, so
// Supavisor never sees interleaved statements. Cost is ~6 sockets per warm
// instance instead of 5, and transactions serialise per instance — irrelevant at
// one transaction per rally, and instances scale horizontally.
//
// (`max_pipeline` is a real postgres.js option — parsed in its option ints —
// but missing from its TypeScript definitions, hence the assertion.)
const SHARED = {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
};

/**
 * Pool for reads and single-statement writes. `max`/`idle_timeout` keep N warm
 * serverless instances from pinning the pooler's client-connection budget.
 *
 * **Cannot run transactions** — `db.transaction()` will throw. Use `dbTx`.
 */
const client = postgres(connectionString, {
  ...SHARED,
  max: 5,
  max_pipeline: 0,
} as postgres.Options<Record<string, never>>);

/**
 * Pool for transactions ONLY. Single connection, so transactions serialise
 * instead of pipelining.
 *
 * One rule for anything written against it: **await each statement inside the
 * transaction body, never `Promise.all`.** Concurrent statements on this
 * connection are precisely the pipelining that wedges the pooler, and the
 * single connection cannot protect against them from inside a transaction.
 */
const txClient = postgres(connectionString, {
  ...SHARED,
  max: 1,
} as postgres.Options<Record<string, never>>);

export const db = drizzle(client, { schema });
/** Transaction entry point — see the note above. */
export const dbTx = drizzle(txClient, { schema });
export { schema };
