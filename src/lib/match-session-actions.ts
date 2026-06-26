"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchSessions, matches } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { newId } from "@/lib/id";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

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
export async function createMatchSession(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const team = str(fd, "team");
  if (team !== "A" && team !== "B") return;

  await db.insert(matchSessions).values({
    id: newId("mses"),
    matchId: g.matchId,
    tenantId: g.tenantId,
    team,
    role: "TEAM_SCORER",
    createdBy: g.userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  revalidatePath(matchPath(g.tenantSlug, g.competitionId, g.matchId));
}

/** Revoke a previously-issued token. */
export async function revokeMatchSession(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const sessionId = str(fd, "sessionId");
  if (!sessionId) return;

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

  revalidatePath(matchPath(g.tenantSlug, g.competitionId, g.matchId));
}
