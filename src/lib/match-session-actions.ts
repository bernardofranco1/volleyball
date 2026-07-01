"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchSessions, matches } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

// Team-tablet tokens default to a single competition day.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

async function gate(fd: FormData) {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const matchId = str(fd, "matchId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return null;
  // Confirm the match is in this competition + tenant.
  const m = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.competitionId, competitionId),
        eq(matches.tenantId, ctx.tenant.id),
      ),
    )
    .limit(1);
  if (m.length === 0) return null;
  return {
    tenantSlug,
    competitionId,
    matchId,
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
  };
}

function matchPath(tenantSlug: string, competitionId: string, matchId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`;
}

/** Mint a team-tablet access token (TEAM_SCORER) for team A or B of a match. */
export async function createMatchSession(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate(fd);
  if (!g) return fail("Match not found.");
  const team = str(fd, "team");
  if (team !== "A" && team !== "B") return fail("Pick a team.");

  const sessionId = newId("mses");
  await db.insert(matchSessions).values({
    id: sessionId,
    matchId: g.matchId,
    tenantId: g.tenantId,
    team,
    role: "TEAM_SCORER",
    createdBy: g.userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  await recordAudit({
    tenantId: g.tenantId,
    actor: { userId: g.userId },
    action: "matchSession.issue",
    entityType: "match",
    entityId: g.matchId,
    summary: `Issued a team-${team} tablet token`,
    metadata: { sessionId, team },
  });
  revalidatePath(matchPath(g.tenantSlug, g.competitionId, g.matchId));
  return ok(`Team ${team} tablet link created.`);
}

/** Revoke a previously-issued token. */
export async function revokeMatchSession(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate(fd);
  if (!g) return fail("Match not found.");
  const sessionId = str(fd, "sessionId");
  if (!sessionId) return fail("Missing session.");

  await db
    .update(matchSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(matchSessions.id, sessionId),
        eq(matchSessions.matchId, g.matchId),
        eq(matchSessions.tenantId, g.tenantId),
      ),
    );

  await recordAudit({
    tenantId: g.tenantId,
    actor: { userId: g.userId },
    action: "matchSession.revoke",
    entityType: "match",
    entityId: g.matchId,
    summary: "Revoked a team tablet token",
    metadata: { sessionId },
  });
  revalidatePath(matchPath(g.tenantSlug, g.competitionId, g.matchId));
  return ok("Token revoked.");
}
