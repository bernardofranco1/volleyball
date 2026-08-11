// Read side of the people registry (spec/24 §6). Mutations live in
// people-actions.ts; these are the query helpers the People pages and the
// pickers share. Every query is scoped by tenantId — a person belongs to one
// tenant and must never surface in another.
import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  matchOfficials,
  matches,
  people,
  personRoles,
  players,
  teams,
  teamStaff,
} from "@/db/schema";

// Constants, labels, types and the pure name formatter live in people-domain.ts
// so client components can import them without pulling drizzle into the browser
// bundle (same split as domain.ts). Re-exported so server code keeps one import.
export * from "@/lib/people-domain";
import {
  personName,
  type PersonDetail,
  type PersonPosition,
  type PersonRole,
  type PersonRow,
  type StaffFunction,
} from "@/lib/people-domain";

export const PEOPLE_PAGE_SIZE = 50;

/**
 * Directory listing: search over names, optional role filter, paginated.
 * Fetches one row beyond the page so the caller knows whether a next page
 * exists without a COUNT (same trick as listTenantMatches).
 */
export async function listPeople(
  tenantId: string,
  opts: { q?: string; role?: PersonRole; page?: number } = {},
): Promise<{ rows: PersonRow[]; hasMore: boolean }> {
  const page = Math.max(0, opts.page ?? 0);
  const conds = [eq(people.tenantId, tenantId), isNull(people.deletedAt)];
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    conds.push(
      or(
        ilike(people.firstName, like),
        ilike(people.lastName, like),
        ilike(people.displayName, like),
      )!,
    );
  }
  if (opts.role) {
    // EXISTS rather than a join: a person with three roles must not appear
    // three times in the directory.
    conds.push(
      sql`exists (select 1 from ${personRoles} where ${personRoles.personId} = ${people.id} and ${personRoles.role} = ${opts.role})`,
    );
  }

  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      displayName: people.displayName,
      federationCode: people.federationCode,
      visPersonNo: people.visPersonNo,
    })
    .from(people)
    .where(and(...conds))
    .orderBy(asc(people.lastName), asc(people.firstName), asc(people.displayName))
    .limit(PEOPLE_PAGE_SIZE + 1)
    .offset(page * PEOPLE_PAGE_SIZE);

  const hasMore = rows.length > PEOPLE_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PEOPLE_PAGE_SIZE) : rows;
  const roles = await rolesFor(pageRows.map((r) => r.id));
  return {
    rows: pageRows.map((r) => ({ ...r, roles: roles.get(r.id) ?? [] })),
    hasMore,
  };
}

async function rolesFor(ids: string[]): Promise<Map<string, PersonRole[]>> {
  const out = new Map<string, PersonRole[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ personId: personRoles.personId, role: personRoles.role })
    .from(personRoles)
    .where(sql`${personRoles.personId} in ${ids}`);
  for (const r of rows) {
    const list = out.get(r.personId) ?? [];
    list.push(r.role as PersonRole);
    out.set(r.personId, list);
  }
  return out;
}

/** Counts per role for the directory's filter chips. */
export async function countPeopleByRole(
  tenantId: string,
): Promise<Record<PersonRole, number>> {
  const rows = await db
    .select({ role: personRoles.role, n: count() })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(personRoles.tenantId, tenantId), isNull(people.deletedAt)))
    .groupBy(personRoles.role);
  const out = { PLAYER: 0, REFEREE: 0, COACH: 0, SCORER: 0 };
  for (const r of rows) out[r.role as PersonRole] = Number(r.n);
  return out;
}

export async function getPerson(
  tenantId: string,
  personId: string,
): Promise<PersonDetail | null> {
  const r = (
    await db
      .select()
      .from(people)
      .where(
        and(
          eq(people.id, personId),
          eq(people.tenantId, tenantId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
  )[0];
  if (!r) return null;
  const roles = (await rolesFor([personId])).get(personId) ?? [];
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    displayName: r.displayName,
    federationCode: r.federationCode,
    visPersonNo: r.visPersonNo,
    gender: r.gender as "M" | "W" | null,
    email: r.email,
    birthdate: r.birthdate,
    userId: r.userId,
    heightCm: r.heightCm,
    weightKg: r.weightKg,
    position: r.position as PersonPosition | null,
    spikeReachCm: r.spikeReachCm,
    blockReachCm: r.blockReachCm,
    handedness: r.handedness as "LEFT" | "RIGHT" | null,
    photoUrl: r.photoUrl,
    refereeLevel: r.refereeLevel,
    notes: r.notes,
    roles,
  };
}

/**
 * Type-ahead source for the roster / officials / staff pickers. Role-filtered so
 * a referee slot doesn't suggest the entire player list, capped small because it
 * renders inside a dropdown.
 */
export async function searchPeople(
  tenantId: string,
  opts: { q?: string; roles?: PersonRole[]; limit?: number } = {},
): Promise<PersonRow[]> {
  const conds = [eq(people.tenantId, tenantId), isNull(people.deletedAt)];
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    conds.push(
      or(
        ilike(people.firstName, like),
        ilike(people.lastName, like),
        ilike(people.displayName, like),
      )!,
    );
  }
  if (opts.roles?.length) {
    conds.push(
      sql`exists (select 1 from ${personRoles} where ${personRoles.personId} = ${people.id} and ${personRoles.role} in ${opts.roles})`,
    );
  }
  const rows = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      displayName: people.displayName,
      federationCode: people.federationCode,
      visPersonNo: people.visPersonNo,
    })
    .from(people)
    .where(and(...conds))
    .orderBy(asc(people.lastName), asc(people.firstName))
    .limit(opts.limit ?? 25);
  const roles = await rolesFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, roles: roles.get(r.id) ?? [] }));
}

export interface PersonUsage {
  rosters: {
    competitionName: string;
    teamName: string;
    jerseyNumber: number | null;
  }[];
  officials: { matchId: string; role: string; competitionName: string }[];
  staff: { competitionName: string; teamName: string; function: string }[];
  /** True when something still references this person (blocks deletion). */
  inUse: boolean;
}

/**
 * Where a person appears. Shown on the editor so an admin can see the
 * consequences of a change before making it, and used to refuse deletion of
 * someone a competition still depends on.
 */
export async function personUsage(
  tenantId: string,
  personId: string,
): Promise<PersonUsage> {
  const [rosters, officials, staff] = await Promise.all([
    db
      .select({
        competitionName: competitions.name,
        teamName: teams.displayName,
        jerseyNumber: players.jerseyNumber,
      })
      .from(players)
      .innerJoin(teams, eq(teams.id, players.teamId))
      .innerJoin(competitions, eq(competitions.id, teams.competitionId))
      .where(and(eq(players.personId, personId), eq(players.tenantId, tenantId))),
    db
      .select({
        matchId: matchOfficials.matchId,
        role: matchOfficials.role,
        competitionName: competitions.name,
      })
      .from(matchOfficials)
      .innerJoin(matches, eq(matches.id, matchOfficials.matchId))
      .innerJoin(competitions, eq(competitions.id, matches.competitionId))
      .where(
        and(
          eq(matchOfficials.personId, personId),
          eq(matchOfficials.tenantId, tenantId),
        ),
      ),
    db
      .select({
        competitionName: competitions.name,
        teamName: teams.displayName,
        function: teamStaff.function,
      })
      .from(teamStaff)
      .innerJoin(teams, eq(teams.id, teamStaff.teamId))
      .innerJoin(competitions, eq(competitions.id, teams.competitionId))
      .where(
        and(eq(teamStaff.personId, personId), eq(teamStaff.tenantId, tenantId)),
      ),
  ]);
  return {
    rosters,
    officials,
    staff,
    inUse: rosters.length + officials.length + staff.length > 0,
  };
}

export interface DuplicateCandidate {
  person: PersonRow;
  /** Why these two look like the same human, strongest signal first. */
  reason: "EMAIL" | "VIS_NUMBER" | "NAME_AND_BIRTHDATE" | "NAME";
  /** Roster/officials/staff references, so an admin can judge which to keep. */
  usageCount: number;
}

/**
 * Candidates that are probably the same human as `personId` (spec/25 §5).
 *
 * Ordered by how much the signal is worth: a shared email or VIS number is
 * near-certain, name+birthdate is strong, a bare name match is a prompt to look
 * rather than evidence. Nothing here merges anything — this only surfaces
 * candidates for a human decision, because an automatic merge on a name match
 * would eventually fold two different players into one and rewrite history on
 * signed scoresheets.
 */
export async function findDuplicateCandidates(
  tenantId: string,
  personId: string,
): Promise<DuplicateCandidate[]> {
  const me = (
    await db
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        displayName: people.displayName,
        email: people.email,
        birthdate: people.birthdate,
        visPersonNo: people.visPersonNo,
      })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.tenantId, tenantId)))
      .limit(1)
  )[0];
  if (!me) return [];

  const others = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      displayName: people.displayName,
      federationCode: people.federationCode,
      visPersonNo: people.visPersonNo,
      email: people.email,
      birthdate: people.birthdate,
    })
    .from(people)
    .where(
      and(
        eq(people.tenantId, tenantId),
        isNull(people.deletedAt),
        sql`${people.id} <> ${personId}`,
      ),
    );

  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  const myName = norm(me.lastName) + "|" + norm(me.firstName);
  const myLabel = norm(me.displayName);

  const scored: DuplicateCandidate[] = [];
  for (const o of others) {
    let reason: DuplicateCandidate["reason"] | null = null;
    if (me.email && o.email && norm(me.email) === norm(o.email)) reason = "EMAIL";
    else if (
      me.visPersonNo != null &&
      o.visPersonNo != null &&
      me.visPersonNo === o.visPersonNo
    )
      reason = "VIS_NUMBER";
    else {
      const sameName =
        (myName !== "|" && myName === norm(o.lastName) + "|" + norm(o.firstName)) ||
        (myLabel !== "" && myLabel === norm(o.displayName));
      if (sameName)
        reason =
          me.birthdate && o.birthdate && me.birthdate === o.birthdate
            ? "NAME_AND_BIRTHDATE"
            : "NAME";
    }
    if (!reason) continue;
    const usage = await personUsage(tenantId, o.id);
    scored.push({
      person: {
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        displayName: o.displayName,
        federationCode: o.federationCode,
        visPersonNo: o.visPersonNo,
        roles: [],
      },
      reason,
      usageCount:
        usage.rosters.length + usage.officials.length + usage.staff.length,
    });
  }

  const rank: Record<DuplicateCandidate["reason"], number> = {
    EMAIL: 0,
    VIS_NUMBER: 1,
    NAME_AND_BIRTHDATE: 2,
    NAME: 3,
  };
  return scored.sort((a, b) => rank[a.reason] - rank[b.reason]);
}

/** Staff currently assigned to a team, for the roster page's coach panel. */
export async function listTeamStaff(
  tenantId: string,
  teamId: string,
): Promise<
  { id: string; function: StaffFunction; personId: string; name: string }[]
> {
  const rows = await db
    .select({
      id: teamStaff.id,
      function: teamStaff.function,
      personId: teamStaff.personId,
      firstName: people.firstName,
      lastName: people.lastName,
      displayName: people.displayName,
    })
    .from(teamStaff)
    .innerJoin(people, eq(people.id, teamStaff.personId))
    .where(and(eq(teamStaff.teamId, teamId), eq(teamStaff.tenantId, tenantId)));
  return rows.map((r) => ({
    id: r.id,
    function: r.function as StaffFunction,
    personId: r.personId,
    name: personName(r),
  }));
}

/** Head coach display name for a team, for the scoresheet coach box (spec/21 G4). */
export async function headCoachName(teamId: string): Promise<string | null> {
  const r = (
    await db
      .select({
        firstName: people.firstName,
        lastName: people.lastName,
        displayName: people.displayName,
      })
      .from(teamStaff)
      .innerJoin(people, eq(people.id, teamStaff.personId))
      .where(and(eq(teamStaff.teamId, teamId), eq(teamStaff.function, "HEAD_COACH")))
      .limit(1)
  )[0];
  return r ? personName(r) : null;
}
