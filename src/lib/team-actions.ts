"use server";

import { revalidatePath } from "next/cache";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { matches, players, teams } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, OK, type FormState } from "@/lib/action-state";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Verify the competition belongs to the caller's tenant; return ids or null. */
async function gate(fd: FormData) {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return null;
  return {
    tenantSlug,
    competitionId,
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
  };
}

function teamsPath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/teams`;
}

export async function createTeam(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate(fd);
  if (!g) return fail("Competition not found.");

  const displayName = str(fd, "displayName");
  if (!displayName) return fail("Team name is required.");

  await db.insert(teams).values({
    id: newId("team"),
    competitionId: g.competitionId,
    tenantId: g.tenantId,
    displayName,
    countryCode: str(fd, "countryCode").toUpperCase() || null,
    clubName: str(fd, "clubName") || null,
    seed: intOrNull(fd, "seed"),
  });

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return OK;
}

export async function updateTeam(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const teamId = str(fd, "teamId");
  const displayName = str(fd, "displayName");
  if (!teamId || !displayName) return;

  await db
    .update(teams)
    .set({
      displayName,
      countryCode: str(fd, "countryCode").toUpperCase() || null,
      seed: intOrNull(fd, "seed"),
    })
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)));

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
}

export async function deleteTeam(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const teamId = str(fd, "teamId");
  if (!teamId) return;

  // A team that already appears in a scheduled match can't be removed (FK +
  // it would orphan results). Guard rather than letting the DB throw.
  const refs = await db
    .select({ id: matches.id })
    .from(matches)
    .where(or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)))
    .limit(1);
  if (refs.length > 0) return;

  await db.delete(players).where(eq(players.teamId, teamId));
  await db
    .delete(teams)
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)));

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "team.delete",
    entityType: "team",
    entityId: teamId,
    summary: `Deleted team and its players`,
    metadata: { competitionId: g.competitionId },
  });
  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
}

export async function createPlayer(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate(fd);
  if (!g) return fail("Competition not found.");
  const teamId = str(fd, "teamId");
  if (!teamId) return fail("Missing team.");

  // Confirm the team is in this competition (tenant already gated above).
  const team = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)))
    .limit(1);
  if (team.length === 0) return fail("Team not found.");

  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (!fullName) return fail("Player name is required.");

  const jerseyNumber = intOrNull(fd, "jerseyNumber");
  if (jerseyNumber != null) {
    const dup = await db
      .select({ id: players.id })
      .from(players)
      .where(
        and(eq(players.teamId, teamId), eq(players.jerseyNumber, jerseyNumber)),
      )
      .limit(1);
    if (dup.length > 0)
      return fail(`Jersey number ${jerseyNumber} is already used on this team.`);
  }

  await db.insert(players).values({
    id: newId("plyr"),
    teamId,
    tenantId: g.tenantId,
    firstName: firstName || null,
    lastName: lastName || null,
    fullName,
    jerseyNumber,
    isCaptain: fd.get("isCaptain") != null,
    isLibero: fd.get("isLibero") != null,
  });

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return OK;
}

export async function deletePlayer(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const playerId = str(fd, "playerId");
  if (!playerId) return;

  // Scope the delete to the tenant to prevent cross-tenant id guessing.
  await db
    .delete(players)
    .where(and(eq(players.id, playerId), eq(players.tenantId, g.tenantId)));

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
}
