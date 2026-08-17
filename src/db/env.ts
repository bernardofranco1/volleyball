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
  assertMatchesVercelEnv(raw as DbSchema);
  return raw as DbSchema;
}

/**
 * Cross-check the schema against the deployment Vercel says this is.
 *
 * Everything else here fails closed EXCEPT the default: "unset means public"
 * is the one path where a *missing* variable silently selects production
 * tables. That is not hypothetical — `DB_SCHEMA` is a single dashboard row on
 * the Preview environment, and deleting it (or adding an environment that
 * never had it) would give a preview deployment production data with no
 * banner, no `search_path`, and no boot check, since `assertDbSchema` decides
 * whether to run from the very variable that went missing.
 *
 * Vercel already knows which kind of deployment this is, so the two facts can
 * be required to agree:
 *
 *   VERCEL_ENV === "production"  ⟺  DB_SCHEMA === "public"
 *
 * Both directions matter. A preview on `public` writes test data into
 * production; a production deployment on `homolog` serves the clone to real
 * users at the canonical domain.
 *
 * Gated on `VERCEL === "1"` — the marker for "running as a Vercel deployment"
 * — so local shells and scripts are untouched. That matters: AGENTS.md tells
 * operators to aim scripts at production with `DB_SCHEMA=public npx tsx …`,
 * and this check must never make that command unusable.
 */
function assertMatchesVercelEnv(schema: DbSchema): void {
  if (process.env.VERCEL !== "1") return;
  const target = process.env.VERCEL_ENV;
  if (!target) return; // nothing to compare against
  const wanted: DbSchema = target === "production" ? "public" : "homolog";
  if (schema === wanted) return;
  throw new Error(
    `Refusing to start: this is a VERCEL_ENV=${target} deployment but DB_SCHEMA resolves to "${schema}" ` +
      `(expected "${wanted}"). ` +
      (wanted === "homolog"
        ? "A non-production deployment must never touch the production tables — set DB_SCHEMA=homolog on this environment."
        : "The production domain must serve the production tables — remove DB_SCHEMA from the Production environment."),
  );
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

/**
 * The same idea applied to Supabase Storage, which is likewise project-global:
 * one `backups` bucket and one `branding` bucket serve both environments, and
 * object keys begin with a tenant id that the clone copies verbatim.
 *
 * Empty in production, so every object keeps the exact key it already has and
 * nothing needs migrating. `homolog/` elsewhere — enough to stop a homologation
 * backup landing on (and, with `upsert: true`, REPLACING) the production backup
 * of the same tenant on the same day.
 *
 * Lives here rather than beside the storage code so that `backup-policy.ts`,
 * which is deliberately free of runtime dependencies, can use it.
 */
export function storagePrefix(): string {
  return IS_PROD_SCHEMA ? "" : `${DB_SCHEMA}/`;
}

/** Namespace a storage object key for the schema this process serves. */
export function scopedStoragePath(path: string): string {
  return `${storagePrefix()}${path}`;
}

/**
 * True when a storage key belongs to THIS environment.
 *
 * The test to apply before DELETING an object whose key came out of a database
 * row: a cloned row points at production's object, so homologation must leave
 * it alone.
 */
export function ownsStoragePath(path: string): boolean {
  const prefix = storagePrefix();
  return prefix
    ? path.startsWith(prefix)
    : !KNOWN.some((s) => s !== "public" && path.startsWith(`${s}/`));
}
