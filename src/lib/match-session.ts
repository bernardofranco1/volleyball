// Team-tablet session-token validation. Tokens are the `match_sessions.id`
// values minted by the scorer (Phase 3 QR generation). They authorise a tablet
// to act for one team of one match — independent of Supabase Auth — so the team
// tablet routes are token-gated, not user-gated.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchSessions } from "@/db/schema";

export interface TabletSession {
  id: string;
  matchId: string;
  tenantId: string;
  team: "A" | "B";
  role: "SCORER" | "TEAM_SCORER" | "VIEWER";
}

/**
 * Resolve a still-valid token bound to (matchId, team): present, not revoked,
 * not expired. Returns null otherwise. Expiry is checked in SQL (`now()`).
 */
export async function validateTabletToken(
  token: string | undefined | null,
  matchId: string,
  team: "A" | "B",
): Promise<TabletSession | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: matchSessions.id,
      matchId: matchSessions.matchId,
      tenantId: matchSessions.tenantId,
      team: matchSessions.team,
      role: matchSessions.role,
    })
    .from(matchSessions)
    .where(
      and(
        eq(matchSessions.id, token),
        eq(matchSessions.matchId, matchId),
        eq(matchSessions.team, team),
        isNull(matchSessions.revokedAt),
        gt(matchSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
