"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, matchSessions, matches, pools, teams } from "@/db/schema";
import { gateCompetition } from "@/lib/action-gate";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { nextMatchNumber } from "@/lib/match-number";
import { fail, ok, type FormState } from "@/lib/action-state";
import { dateTimeOrNull, intOrNull, str } from "@/lib/form-data";

function schedulePath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/schedule`;
}

/** Confirm both ids are teams in this competition. */
async function validPair(competitionId: string, a: string, b: string) {
  if (!a || !b || a === b) return false;
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(eq(teams.competitionId, competitionId), inArray(teams.id, [a, b])),
    );
  return rows.length === 2;
}

export async function createMatch(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const teamAId = str(fd, "teamAId");
  const teamBId = str(fd, "teamBId");
  if (!(await validPair(g.competitionId, teamAId, teamBId)))
    return fail("Pick two different teams from this competition.");

  await db.insert(matches).values({
    id: newId("match"),
    competitionId: g.competitionId,
    tenantId: g.tenantId,
    teamAId,
    teamBId,
    discipline: g.discipline,
    status: "SCHEDULED",
    courtNumber: intOrNull(fd, "courtNumber"),
    scheduledAt: dateTimeOrNull(fd, "scheduledAt"),
    roundName: str(fd, "roundName") || null,
    matchNumber:
      intOrNull(fd, "matchNumber") ?? (await nextMatchNumber(db, g.competitionId)),
  });

  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
  return ok("Match created.");
}

/** Assign / change court + time for an existing match. */
export async function updateMatchSlot(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const matchId = str(fd, "matchId");
  if (!matchId) return fail("Missing match.");

  await db
    .update(matches)
    .set({
      courtNumber: intOrNull(fd, "courtNumber"),
      scheduledAt: dateTimeOrNull(fd, "scheduledAt"),
      roundName: str(fd, "roundName") || null,
    })
    .where(
      and(eq(matches.id, matchId), eq(matches.competitionId, g.competitionId)),
    );

  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
  return ok("Saved.");
}

export async function deleteMatch(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const matchId = str(fd, "matchId");
  if (!matchId) return fail("Missing match.");

  // Only un-played matches can be deleted (anything with events is a record).
  const ev = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.matchId, matchId))
    .limit(1);
  if (ev.length > 0)
    return fail("This match has been scored — it's a record and can't be deleted.");

  await db.transaction(async (tx) => {
    await tx.delete(matchSessions).where(eq(matchSessions.matchId, matchId));
    await tx
      .delete(matches)
      .where(
        and(eq(matches.id, matchId), eq(matches.competitionId, g.competitionId)),
      );
  });

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "match.delete",
    entityType: "match",
    entityId: matchId,
    summary: "Deleted a scheduled match",
    metadata: { competitionId: g.competitionId },
  });
  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
  return ok("Match deleted.");
}

/**
 * Generate single round-robin fixtures. Pool-aware: when the competition has
 * pools, each pool gets its own round-robin (roundName = pool name) and
 * cross-pool pairs are NOT created; unpooled teams pair among themselves.
 * Without pools, every unordered pair plays. Idempotent — re-running only
 * fills gaps.
 */
export async function generateRoundRobin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const [teamRows, poolRows, existing] = await Promise.all([
    db
      .select({ id: teams.id, seed: teams.seed, poolId: teams.poolId })
      .from(teams)
      .where(eq(teams.competitionId, g.competitionId))
      .orderBy(asc(teams.seed)),
    db
      .select({ id: pools.id, name: pools.name })
      .from(pools)
      .where(eq(pools.competitionId, g.competitionId)),
    db
      .select({ a: matches.teamAId, b: matches.teamBId })
      .from(matches)
      .where(eq(matches.competitionId, g.competitionId)),
  ]);
  if (teamRows.length < 2)
    return fail("Add at least two teams before generating fixtures.");

  const key = (a: string, b: string) => [a, b].sort().join("|");
  const seen = new Set(existing.map((m) => key(m.a, m.b)));
  const poolName = new Map(poolRows.map((p) => [p.id, p.name]));
  const hasPools = teamRows.some((t) => t.poolId != null);

  // Group teams: per pool when pools exist (unpooled teams form their own
  // group), otherwise everyone together.
  const groups = new Map<string, typeof teamRows>();
  for (const t of teamRows) {
    const k = hasPools ? (t.poolId ?? "__unpooled__") : "__all__";
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }

  let n = await nextMatchNumber(db, g.competitionId);
  const rows: (typeof matches.$inferInsert)[] = [];
  for (const [groupKey, group] of groups) {
    const roundName =
      groupKey === "__all__" || groupKey === "__unpooled__"
        ? "Round Robin"
        : (poolName.get(groupKey) ?? "Round Robin");
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].id;
        const b = group[j].id;
        if (seen.has(key(a, b))) continue;
        seen.add(key(a, b));
        rows.push({
          id: newId("match"),
          competitionId: g.competitionId,
          tenantId: g.tenantId,
          teamAId: a,
          teamBId: b,
          discipline: g.discipline,
          status: "SCHEDULED",
          roundName,
          matchNumber: n++,
        });
      }
    }
  }
  if (rows.length > 0) await db.insert(matches).values(rows);

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "schedule.round_robin",
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Generated ${rows.length} round-robin fixture(s)${hasPools ? " (per pool)" : ""}`,
  });
  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
  return rows.length > 0
    ? ok(
        hasPools
          ? `Created ${rows.length} fixture(s) across ${groups.size} group(s).`
          : `Created ${rows.length} fixture(s).`,
      )
    : ok("Nothing to add — all pairings already exist.");
}
