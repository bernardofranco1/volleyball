/**
 * Which set of tables this process talks to (spec/28).
 *
 * Production and homologation share ONE database and are separated by Postgres
 * schema: production is `public` (exactly as it always was), homologation is
 * `homolog`, a refreshable clone. The choice is an environment variable read at
 * boot, never a runtime decision — a warm instance holding a stale decision
 * could otherwise write test data into production tables during a promote.
 *
 * Nothing else in the codebase knows about this: queries stay unqualified and
 * Postgres resolves them through `search_path`.
 */

/** The only schemas we will ever point at. Anything else is a typo. */
const KNOWN = ["public", "homolog"] as const;
export type DbSchema = (typeof KNOWN)[number];

function resolve(): DbSchema {
  // An empty value counts as unset — a blank env var in a dashboard is a very
  // common way to "remove" one, and it must mean production, not a crash.
  const raw = (process.env.DB_SCHEMA ?? "").trim() || "public";
  if (!(KNOWN as readonly string[]).includes(raw)) {
    // Fail loudly at boot rather than silently serving the wrong tables.
    throw new Error(
      `DB_SCHEMA must be one of ${KNOWN.join(" | ")} — got "${raw}"`,
    );
  }
  return raw as DbSchema;
}

export const DB_SCHEMA: DbSchema = resolve();

/** True when this process is talking to the production tables. */
export const IS_PROD_SCHEMA = DB_SCHEMA === "public";

/**
 * The `search_path` for a connection, or null to leave the server default
 * alone (production keeps today's connection byte-for-byte).
 *
 * Deliberately a SINGLE application schema with no `public` fallback: with
 * `homolog,public` in the path, any table missing from the clone would resolve
 * silently against production data. One entry means a missing table is a loud
 * error instead. `extensions` is where Supabase installs pgcrypto et al, so it
 * stays reachable for functions (never for tables — we own no table there).
 */
export function searchPathFor(schema: DbSchema): string | null {
  return schema === "public" ? null : `${schema}, extensions`;
}

/**
 * Namespace for anything keyed outside the schema — Postgres advisory locks are
 * database-global, and Supabase Realtime channel names are project-global, so
 * homolog and production would otherwise collide on identical (cloned) ids.
 */
export function envKey(key: string): string {
  return IS_PROD_SCHEMA ? key : `${DB_SCHEMA}:${key}`;
}
