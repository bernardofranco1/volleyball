/**
 * Release history and the checks that run before a promotion (spec/28 §7).
 *
 * Read side + guard computation only; the mutations live in
 * release-actions.ts. Platform-level throughout — a release is the whole
 * deployment, not one tenant's data.
 */
import { desc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_SCHEMA } from "@/db/env";
import { releases, tenants } from "@/db/schema";
// The journal ships in the bundle as JSON, so migration state needs no
// filesystem access at runtime (the .sql files are not bundled, and don't need
// to be — the console reports counts, and CI lints the contents).
import journal from "@/db/migrations/meta/_journal.json";

export type ReleaseRow = typeof releases.$inferSelect;

export const MIGRATIONS_IN_REPO = journal.entries.length;

export async function listReleases(limit = 25): Promise<ReleaseRow[]> {
  return db.select().from(releases).orderBy(desc(releases.createdAt)).limit(limit);
}

export async function latestRelease(): Promise<ReleaseRow | null> {
  const rows = await db
    .select()
    .from(releases)
    .orderBy(desc(releases.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface MigrationState {
  inRepo: number;
  appliedProd: number;
  appliedHomolog: number | null;
  /** Migrations the repo has that production has not run yet. */
  pendingProd: number;
}

/**
 * How the two schemas stand against the repo.
 *
 * Counting rows in each journal rather than diffing hashes: the question the
 * console has to answer before a promotion is "does production still need
 * migrating", and a count answers it. Drizzle applies migrations in order and
 * refuses to reorder, so a count is not a lie here.
 */
export async function migrationState(): Promise<MigrationState> {
  const count = async (schema: string): Promise<number | null> => {
    try {
      const r = await db.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier(schema)}.__drizzle_migrations`,
      );
      // drizzle's execute returns rows in different shapes across drivers.
      const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows) ?? [];
      const first = rows[0] as { n?: string } | undefined;
      return first?.n ? Number(first.n) : 0;
    } catch {
      // The homolog journal only exists once the clone has been built.
      return null;
    }
  };
  const [appliedProd, appliedHomolog] = await Promise.all([
    count("drizzle"),
    count("drizzle_homolog"),
  ]);
  const prod = appliedProd ?? 0;
  return {
    inRepo: MIGRATIONS_IN_REPO,
    appliedProd: prod,
    appliedHomolog,
    pendingProd: Math.max(0, MIGRATIONS_IN_REPO - prod),
  };
}

export interface LiveMatchWarning {
  count: number
  /** A few names, so the warning is concrete rather than a number. */
  samples: string[];
}

/**
 * Matches being scored RIGHT NOW, across every tenant.
 *
 * Promoting swaps the code under whoever is holding a tablet at a match, and
 * the old build's hashed assets stop resolving at the domain. It is never
 * forbidden — a hotfix during a match is exactly when you need to ship — but it
 * must be a deliberate choice, so the console says who is mid-match.
 *
 * Always counts PRODUCTION matches: the console may itself be running on the
 * homolog tables, and "is anyone live" is a question about production.
 */
export async function liveMatches(): Promise<LiveMatchWarning> {
  const table =
    DB_SCHEMA === "public"
      ? sql`matches`
      : sql`public.matches`;
  const teamTable =
    DB_SCHEMA === "public" ? sql`teams` : sql`public.teams`;
  const r = await db.execute<{ label: string }>(sql`
    select coalesce(a.display_name, '?') || ' – ' || coalesce(b.display_name, '?') as label
    from ${table} m
    left join ${teamTable} a on a.id = m.team_a_id
    left join ${teamTable} b on b.id = m.team_b_id
    where m.status = 'LIVE'
    limit 10`);
  const rows = ((Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows) ??
    []) as { label: string }[];
  return { count: rows.length, samples: rows.map((x) => x.label) };
}

/** Tenants a promotion should back up first — i.e. all of them. */
export async function allTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  return rows.map((r) => r.id);
}
