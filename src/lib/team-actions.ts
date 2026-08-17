"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, or } from "drizzle-orm";
import { db, dbTx } from "@/db";
import { matches, players, teams } from "@/db/schema";
import { SCORING_ROLES, authorizeMatch } from "@/lib/authz";
import { gateCompetition } from "@/lib/action-gate";
import { normalizeHex } from "@/lib/colors";
import { isStaffFunction, type StaffFunction } from "@/lib/roster";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { resolvePickedPerson } from "@/lib/people-actions";
import { fail, ok, type FormState } from "@/lib/action-state";
import { intOrNull, str } from "@/lib/form-data";

function teamsPath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/teams`;
}

export async function createTeam(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
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
    color: normalizeHex(str(fd, "color")),
  });

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return ok(`Added ${displayName}.`);
}

/**
 * Add several teams at once — one display name per line, with an optional
 * ",XXX" country suffix (e.g. "Berlin Recycling,GER"). Skips names that
 * already exist in the competition so a re-paste is idempotent.
 */
export async function bulkAddTeams(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const lines = str(fd, "names")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return fail("Enter one team name per line.");
  if (lines.length > 128) return fail("Too many teams at once (max 128).");

  const existing = await db
    .select({ name: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const seen = new Set(existing.map((t) => t.name.toLowerCase()));

  const rows: (typeof teams.$inferInsert)[] = [];
  for (const line of lines) {
    const [name, country] = line.split(",").map((p) => p.trim());
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    rows.push({
      id: newId("team"),
      competitionId: g.competitionId,
      tenantId: g.tenantId,
      displayName: name,
      countryCode: country ? country.toUpperCase().slice(0, 3) : null,
    });
  }
  if (rows.length > 0) await db.insert(teams).values(rows);

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "team.bulk_add",
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Bulk-added ${rows.length} team(s)`,
  });
  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  const skipped = lines.length - rows.length;
  return ok(
    `Added ${rows.length} team(s)${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ""}.`,
  );
}

/**
 * Set both teams' colours for a match (brief §1.4). Scorer-accessible (mirrors
 * the team-tablet authorisation model) so colours can be picked before the match.
 */
export async function setTeamColors(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, SCORING_ROLES);
  if (!authed.ok) return fail("Not allowed.");

  const rows = await db
    .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const m = rows[0];
  if (!m) return fail("Match not found.");

  await db
    .update(teams)
    .set({ color: normalizeHex(str(fd, "colorA")) })
    .where(eq(teams.id, m.teamAId));
  await db
    .update(teams)
    .set({ color: normalizeHex(str(fd, "colorB")) })
    .where(eq(teams.id, m.teamBId));

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  revalidatePath(
    `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`,
  );
  return ok("Colours saved.");
}

export async function updateTeam(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const teamId = str(fd, "teamId");
  if (!teamId) return fail("Missing team.");
  const displayName = str(fd, "displayName");
  if (!displayName) return fail("Team name is required.");

  await db
    .update(teams)
    .set({
      displayName,
      countryCode: str(fd, "countryCode").toUpperCase() || null,
      seed: intOrNull(fd, "seed"),
    })
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)));

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return ok("Saved.");
}

export async function deleteTeam(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const teamId = str(fd, "teamId");
  if (!teamId) return fail("Missing team.");

  // A team that already appears in a scheduled match can't be removed (FK +
  // it would orphan results). Guard rather than letting the DB throw.
  const refs = await db
    .select({ id: matches.id })
    .from(matches)
    .where(or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)))
    .limit(1);
  if (refs.length > 0)
    return fail(
      "This team appears in a match. Delete its matches first, then remove the team.",
    );

  await dbTx.transaction(async (tx) => {
    await tx.delete(players).where(eq(players.teamId, teamId));
    await tx
      .delete(teams)
      .where(
        and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)),
      );
  });

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
  // Deletion is driven from the team's own page, which no longer exists once
  // the row is gone — send the admin back to the list rather than re-rendering
  // a 404. redirect() throws NEXT_REDIRECT, so it must sit outside try/catch.
  redirect(teamsPath(g.tenantSlug, g.competitionId));
}

export async function createPlayer(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
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

  // Rosters reference the tenant people registry (spec/24 §6.2). The picker
  // sends an id when the typed name matched someone, or just the name — in which
  // case a person is created, so a roster row is never left unlinked.
  const picked = await resolvePickedPerson(
    g.tenantId,
    { personId: str(fd, "personId"), personName: str(fd, "personName") },
    "PLAYER",
  );
  if ("error" in picked) return fail(picked.error);
  const fullName = picked.name;

  // One person, one roster spot per competition (spec/25 §4). The DB refuses a
  // repeat on the same team; two teams in the same competition needs a query,
  // because players link to a competition only through their team.
  const already = await db
    .select({ teamId: players.teamId })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(
      and(
        eq(players.personId, picked.id),
        eq(teams.competitionId, g.competitionId),
      ),
    )
    .limit(1);
  if (already.length > 0)
    return fail(
      `${fullName} is already on a roster in this competition. One person can only play for one team — remove the other entry first.`,
    );

  // Decide the kind FIRST: a bench official carries no jersey number, so the
  // uniqueness check below must not run for them. It used to, which meant a
  // stale value left in the form's number field could refuse a coach for a
  // clash that cannot apply to them (found by the spec/31 action tests).
  const kind = rosterKind(fd);
  const jerseyNumber = kind.role === "STAFF" ? null : intOrNull(fd, "jerseyNumber");
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
    personId: picked.id,
    // A bench official occupies no playing spot: no number, no C/L flags.
    jerseyNumber,
    isCaptain: kind.role !== "STAFF" && fd.get("isCaptain") != null,
    isLibero: kind.role !== "STAFF" && fd.get("isLibero") != null,
    role: kind.role,
    staffFunction: kind.staffFunction,
  });

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return ok(`Added ${fullName}.`);
}

/**
 * Roster kind + scoresheet function from the form (spec/29 F1).
 *
 * A row is STAFF exactly when a function code was chosen; that keeps the form
 * to one control instead of a role radio plus a code select that can disagree.
 * A staff row can hold neither jersey number nor captain/libero flags — those
 * are facts about a playing spot.
 */
function rosterKind(fd: FormData): {
  role: "PLAYER" | "STAFF";
  staffFunction: StaffFunction | null;
} {
  const raw = str(fd, "staffFunction");
  return isStaffFunction(raw)
    ? { role: "STAFF", staffFunction: raw }
    : { role: "PLAYER", staffFunction: null };
}

/** Edit a player in place — fixes the delete-and-re-add-only roster flow. */
export async function updatePlayer(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const playerId = str(fd, "playerId");
  if (!playerId) return fail("Missing player.");

  const current = (
    await db
      .select({ id: players.id, teamId: players.teamId })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, g.tenantId)))
      .limit(1)
  )[0];
  if (!current) return fail("Player not found.");

  // A roster row owns the jersey number and the captain/libero flags. The NAME
  // belongs to the person (spec/24 §2.3) — editing it here would have changed
  // only this competition's copy, which is the duplication the registry removes.
  // The roster row links to the person editor instead.
  // Kind first — see createPlayer: staff carry no number, so the uniqueness
  // check must not run for them.
  const kind = rosterKind(fd);
  const jerseyNumber = kind.role === "STAFF" ? null : intOrNull(fd, "jerseyNumber");
  if (jerseyNumber != null) {
    const dup = await db
      .select({ id: players.id })
      .from(players)
      .where(
        and(
          eq(players.teamId, current.teamId),
          eq(players.jerseyNumber, jerseyNumber),
        ),
      )
      .limit(1);
    if (dup.length > 0 && dup[0].id !== playerId)
      return fail(`Jersey number ${jerseyNumber} is already used on this team.`);
  }
  await db
    .update(players)
    .set({
      jerseyNumber,
      isCaptain: kind.role !== "STAFF" && fd.get("isCaptain") != null,
      isLibero: kind.role !== "STAFF" && fd.get("isLibero") != null,
      role: kind.role,
      staffFunction: kind.staffFunction,
    })
    .where(eq(players.id, playerId));

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return ok("Saved.");
}

export async function deletePlayer(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const playerId = str(fd, "playerId");
  if (!playerId) return fail("Missing player.");

  // Scope the delete to the tenant to prevent cross-tenant id guessing.
  await db
    .delete(players)
    .where(and(eq(players.id, playerId), eq(players.tenantId, g.tenantId)));

  revalidatePath(teamsPath(g.tenantSlug, g.competitionId));
  return ok("Player removed.");
}
