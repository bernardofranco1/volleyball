/**
 * Match number → the competition that owns it (spec/38).
 *
 * VIS match numbers are globally unique, so a board can be addressed by number
 * alone — which is what the public board host does (`/m/27547`). Resolving the
 * competition is still required, because the board is rendered with that
 * competition's branding and background, and because the allowlist is what
 * stops this being an open relay onto VIS for arbitrary numbers.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { competitions, tenants } from "@/db/schema";
import { tournamentOfMatch } from "./store";

export interface VisCompetitionRef {
  competitionId: string;
  competitionName: string;
  tenantId: string;
  tenantSlug: string;
  visTournamentNo: number;
}

/** Every VIS-linked competition on the platform, for the public index. */
export async function visCompetitions(): Promise<VisCompetitionRef[]> {
  const rows = await db
    .select({
      competitionId: competitions.id,
      competitionName: competitions.name,
      tenantId: competitions.tenantId,
      tenantSlug: tenants.slug,
      visTournamentNo: competitions.visTournamentNo,
    })
    .from(competitions)
    .innerJoin(tenants, eq(tenants.id, competitions.tenantId))
    .where(isNotNull(competitions.visTournamentNo));
  return rows
    .filter((r): r is VisCompetitionRef => r.visTournamentNo != null)
    .sort((a, b) => a.competitionName.localeCompare(b.competitionName));
}

/** The competition a match belongs to, or null when it is not on the allowlist. */
export async function competitionForMatch(
  matchNo: number,
): Promise<VisCompetitionRef | null> {
  const tournamentNo = await tournamentOfMatch(matchNo).catch(() => null);
  if (tournamentNo == null) return null;
  const all = await visCompetitions();
  return all.find((c) => c.visTournamentNo === tournamentNo) ?? null;
}
