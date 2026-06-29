import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, tenants } from "@/db/schema";

/**
 * Resolve a match id to its tenant slug + competition (brief §5). Lets short
 * top-level URLs (/Scoreboard/{id}, /Scorers/{id}, /Tablets/{id}/A) redirect to
 * the canonical tenant-scoped routes without a slug in the URL.
 */
export async function resolveMatchRoute(
  matchId: string,
): Promise<{ tenantSlug: string; competitionId: string } | null> {
  const rows = await db
    .select({ slug: tenants.slug, competitionId: matches.competitionId })
    .from(matches)
    .innerJoin(tenants, eq(tenants.id, matches.tenantId))
    .where(eq(matches.id, matchId))
    .limit(1);
  const r = rows[0];
  return r ? { tenantSlug: r.slug, competitionId: r.competitionId } : null;
}
