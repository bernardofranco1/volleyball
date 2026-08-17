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
import { MIGRATIONS_IN_REPO } from "@/lib/migrations-manifest";

export type ReleaseRow = typeof releases.$inferSelect;

export { MIGRATIONS_IN_REPO };

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
  /** What THIS build (the console) carries — not the candidate's figure. */
  inRepo: number;
  /** null when the count could not be read: unknown, never assumed to be 0. */
  appliedProd: number | null;
  appliedHomolog: number | null;
  /**
   * Migrations this console's build has that production has not run yet, or
   * null when `appliedProd` is unknown.
   *
   * Indicative only — it compares against the CONSOLE's journal. The gate on a
   * promotion asks the candidate what it needs (see promoteRelease); this drives
   * the dashboard tile.
   */
  pendingProd: number | null;
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
    const r = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from ${sql.identifier(schema)}.__drizzle_migrations`,
    );
    // drizzle's execute returns rows in different shapes across drivers.
    const rows = (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows) ?? [];
    const first = rows[0] as { n?: string } | undefined;
    return first?.n ? Number(first.n) : 0;
  };
  const [appliedProd, appliedHomolog] = await Promise.all([
    // A failure here is NOT "production has run nothing". Swallowing it used to
    // yield appliedProd = 0, which reads as "every migration is pending" and
    // hard-blocked promotion AND rollback behind a remedy (`db:migrate:prod`)
    // that would report nothing to do. Unknown stays unknown; the caller
    // decides what an unknown means for the operation it is about to perform.
    count("drizzle").catch(() => null),
    // The homolog journal genuinely does not exist until the clone is built, so
    // absence is an ordinary state here rather than a fault.
    count("drizzle_homolog").catch(() => null),
  ]);
  return {
    inRepo: MIGRATIONS_IN_REPO,
    appliedProd,
    appliedHomolog,
    pendingProd:
      appliedProd === null ? null : Math.max(0, MIGRATIONS_IN_REPO - appliedProd),
  };
}

export type MigrationVerdict =
  | { ok: true; warning: string | null }
  | { ok: false; error: string };

/**
 * May this build take the production domain, given the number of migrations it
 * expects and the number production has actually run?
 *
 * Pure on purpose: it is the whole safety argument of a promotion, and it
 * should be readable and testable without a database or a Vercel account.
 *
 * `required` is the CANDIDATE's own figure, read from its /api/version — never
 * the console's bundled count. The console is routinely an older build, and
 * comparing its own journal against production reported "nothing pending" in
 * exactly the case this guard exists for.
 *
 * Rollback needs no special case: an older build requires fewer migrations than
 * production has applied, so it passes the same comparison. It differs only in
 * what an UNKNOWN means — refusing a rollback because a number could not be
 * read would block the recovery path at the moment it is most needed, so an
 * unknown warns there and refuses on the way forward.
 */
export function migrationVerdict(opts: {
  required: number | null;
  applied: number | null;
  action: "PROMOTE" | "ROLLBACK";
}): MigrationVerdict {
  const { required, applied, action } = opts;

  if (required === null || applied === null) {
    const why =
      required === null
        ? "the candidate did not report how many migrations it needs"
        : "production's applied-migration count could not be read";
    return action === "PROMOTE"
      ? {
          ok: false,
          error: `Cannot verify production's schema is ready — ${why}. Check /api/version on the candidate (deployment URLs need the automation bypass secret) or run \`npm run db:migrate:prod\`, then retry.`,
        }
      : {
          ok: true,
          warning: `rolled back without verifying migrations — ${why}`,
        };
  }

  if (required > applied)
    return {
      ok: false,
      error: `That build expects ${required} migration(s); production has applied ${applied}. Run \`npm run db:migrate:prod\` first — promoting now would serve code against a schema that lacks its columns.`,
    };

  return { ok: true, warning: null };
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
  // The COUNT is over every live match; only the sample list is capped. Taking
  // `rows.length` from a `limit 10` query made the warning say "10 matches" on
  // a busy evening with 40 — understating the blast radius in exactly the
  // situation where the operator most needs the real number.
  const r = await db.execute<{ label: string; total: string }>(sql`
    select coalesce(a.display_name, '?') || ' – ' || coalesce(b.display_name, '?') as label,
           count(*) over ()::text as total
    from ${table} m
    left join ${teamTable} a on a.id = m.team_a_id
    left join ${teamTable} b on b.id = m.team_b_id
    where m.status = 'LIVE'
    limit 10`);
  const rows = ((Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows) ??
    []) as { label: string; total: string }[];
  return {
    count: rows.length > 0 ? Number(rows[0].total) : 0,
    samples: rows.map((x) => x.label),
  };
}

/** Tenants a promotion should back up first — i.e. all of them. */
export async function allTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  return rows.map((r) => r.id);
}
