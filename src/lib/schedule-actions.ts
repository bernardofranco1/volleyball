"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, matchSessions, matches, teams } from "@/db/schema";
import type { Discipline } from "@/engine/types";
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
/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`, no zone) → Date, interpreted as
 * UTC (spec/14 §E2). The schedule UI labels and prefills times in UTC, so this
 * makes the round-trip exact regardless of the server's local timezone.
 */
function dateTimeOrNull(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  if (!v) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasZone ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
    discipline: comp.discipline as Discipline,
    actor: { userId: ctx.user.id, email: ctx.user.email },
  };
}

function schedulePath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/schedule`;
}

async function nextMatchNumber(competitionId: string): Promise<number> {
  const rows = await db
    .select({ n: matches.matchNumber })
    .from(matches)
    .where(eq(matches.competitionId, competitionId));
  const max = rows.reduce((m, r) => Math.max(m, r.n ?? 0), 0);
  return max + 1;
}

/** Confirm both ids are teams in this competition. */
async function validPair(competitionId: string, a: string, b: string) {
  if (!a || !b || a === b) return false;
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.competitionId, competitionId));
  const ids = new Set(rows.map((r) => r.id));
  return ids.has(a) && ids.has(b);
}

export async function createMatch(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate(fd);
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
    matchNumber: intOrNull(fd, "matchNumber") ?? (await nextMatchNumber(g.competitionId)),
  });

  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
  return OK;
}

/** Assign / change court + time for an existing match. */
export async function updateMatchSlot(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const matchId = str(fd, "matchId");
  if (!matchId) return;

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
}

export async function deleteMatch(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const matchId = str(fd, "matchId");
  if (!matchId) return;

  // Only un-played matches can be deleted (anything with events is a record).
  const ev = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.matchId, matchId))
    .limit(1);
  if (ev.length > 0) return;

  await db.delete(matchSessions).where(eq(matchSessions.matchId, matchId));
  await db
    .delete(matches)
    .where(
      and(eq(matches.id, matchId), eq(matches.competitionId, g.competitionId)),
    );

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
}

/**
 * Generate single round-robin fixtures: every unordered pair of teams that
 * doesn't already have a match. Idempotent — re-running only fills gaps.
 */
export async function generateRoundRobin(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;

  const teamRows = await db
    .select({ id: teams.id, seed: teams.seed })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId))
    .orderBy(asc(teams.seed));
  if (teamRows.length < 2) return;

  const existing = await db
    .select({ a: matches.teamAId, b: matches.teamBId })
    .from(matches)
    .where(eq(matches.competitionId, g.competitionId));
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const seen = new Set(existing.map((m) => key(m.a, m.b)));

  let n = await nextMatchNumber(g.competitionId);
  const rows: (typeof matches.$inferInsert)[] = [];
  for (let i = 0; i < teamRows.length; i++) {
    for (let j = i + 1; j < teamRows.length; j++) {
      const a = teamRows[i].id;
      const b = teamRows[j].id;
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
        roundName: "Round Robin",
        matchNumber: n++,
      });
    }
  }
  if (rows.length > 0) await db.insert(matches).values(rows);

  revalidatePath(schedulePath(g.tenantSlug, g.competitionId));
}
