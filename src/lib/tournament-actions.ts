"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, pools, teams } from "@/db/schema";

// The transaction executor type (db or a transaction handle).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import {
  bracketSize,
  isKnockoutRound,
  roundLabel,
  seedOrder,
} from "@/lib/bracket";
import { newId } from "@/lib/id";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
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
  };
}

function standingsPath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/standings`;
}

async function nextMatchNumber(
  exec: Tx,
  competitionId: string,
): Promise<number> {
  const rows = await exec
    .select({ n: matches.matchNumber })
    .from(matches)
    .where(eq(matches.competitionId, competitionId));
  return rows.reduce((m, r) => Math.max(m, r.n ?? 0), 0) + 1;
}

// ── Pools ─────────────────────────────────────────────────────────────────────

export async function createPool(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const name = str(fd, "name");
  if (!name) return;
  await db.insert(pools).values({
    id: newId("pool"),
    competitionId: g.competitionId,
    tenantId: g.tenantId,
    name,
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
}

/** Assign (or clear, when poolId is empty) a team's pool. */
export async function assignTeamPool(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;
  const teamId = str(fd, "teamId");
  const poolId = str(fd, "poolId") || null;
  if (!teamId) return;
  // A non-empty pool must belong to this competition (spec/14 §E4) — otherwise
  // a crafted poolId could attach a team to a foreign competition's pool.
  if (poolId) {
    const valid = await db
      .select({ id: pools.id })
      .from(pools)
      .where(and(eq(pools.id, poolId), eq(pools.competitionId, g.competitionId)))
      .limit(1);
    if (valid.length === 0) return;
  }
  await db
    .update(teams)
    .set({ poolId })
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)));
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
}

// ── Knockout bracket ───────────────────────────────────────────────────────────

/**
 * Seed the largest power-of-two field by team seed and create round 1. Wrapped in
 * a per-competition advisory lock so concurrent clicks can't double-generate
 * (spec/14 §E1); a partial unique index on (competition, round, match#) backstops.
 */
export async function generateBracket(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${g.competitionId}))`);

    const existing = await tx
      .select({ roundName: matches.roundName })
      .from(matches)
      .where(eq(matches.competitionId, g.competitionId));
    if (existing.some((m) => isKnockoutRound(m.roundName))) return; // already done

    const teamRows = await tx
      .select({ id: teams.id, seed: teams.seed, displayName: teams.displayName })
      .from(teams)
      .where(eq(teams.competitionId, g.competitionId))
      .orderBy(asc(teams.seed), asc(teams.displayName));
    if (teamRows.length < 2) return;

    const size = bracketSize(teamRows.length);
    const field = teamRows.slice(0, size); // seeds 1..size in seed order
    const order = seedOrder(size);
    const label = roundLabel(size);
    let n = await nextMatchNumber(tx, g.competitionId);

    const rows: (typeof matches.$inferInsert)[] = [];
    for (let j = 0; j < size / 2; j++) {
      const a = field[order[2 * j] - 1];
      const b = field[order[2 * j + 1] - 1];
      rows.push({
        id: newId("match"),
        competitionId: g.competitionId,
        tenantId: g.tenantId,
        teamAId: a.id,
        teamBId: b.id,
        discipline: g.discipline,
        status: "SCHEDULED",
        roundName: label,
        matchNumber: n++,
      });
    }
    await tx.insert(matches).values(rows);
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
}

interface KMatch {
  id: string;
  teamAId: string;
  teamBId: string;
  status: string;
  winner: "A" | "B" | null;
  roundName: string | null;
  matchNumber: number | null;
}

const winnerId = (m: KMatch) => (m.winner === "A" ? m.teamAId : m.teamBId);
const loserId = (m: KMatch) => (m.winner === "A" ? m.teamBId : m.teamAId);

/**
 * Create every next round whose feeder round is fully decided. Idempotent and
 * loops so one call advances as far as the current results allow. When the
 * semifinals complete, also creates the 3rd-place match from the two losers.
 */
export async function advanceBracket(fd: FormData): Promise<void> {
  const g = await gate(fd);
  if (!g) return;

  await db.transaction(async (tx) => {
    // Serialize concurrent advances for this competition (spec/14 §E1).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${g.competitionId}))`);

    for (let guard = 0; guard < 8; guard++) {
      const all = (await tx
        .select({
          id: matches.id,
          teamAId: matches.teamAId,
          teamBId: matches.teamBId,
          status: matches.status,
          winner: matches.winner,
          roundName: matches.roundName,
          matchNumber: matches.matchNumber,
        })
        .from(matches)
        .where(eq(matches.competitionId, g.competitionId))) as KMatch[];

      const present = new Set(
        all.filter((m) => isKnockoutRound(m.roundName)).map((m) => m.roundName),
      );
      let created = false;

      for (const size of [64, 32, 16, 8, 4]) {
        const label = roundLabel(size);
        const nextLabel = roundLabel(size / 2);
        const round = all
          .filter((m) => m.roundName === label)
          .sort((x, y) => (x.matchNumber ?? 0) - (y.matchNumber ?? 0));
        if (round.length === 0) continue;
        if (present.has(nextLabel)) continue; // next round already exists
        if (!round.every((m) => m.status === "FINISHED" && m.winner)) continue;

        let n = await nextMatchNumber(tx, g.competitionId);
        const rows: (typeof matches.$inferInsert)[] = [];
        for (let j = 0; j < round.length / 2; j++) {
          rows.push({
            id: newId("match"),
            competitionId: g.competitionId,
            tenantId: g.tenantId,
            teamAId: winnerId(round[2 * j]),
            teamBId: winnerId(round[2 * j + 1]),
            discipline: g.discipline,
            status: "SCHEDULED",
            roundName: nextLabel,
            matchNumber: n++,
          });
        }
        // Semifinal → also stage the 3rd-place match from the losers.
        if (size === 4 && round.length === 2 && !present.has("3rd Place")) {
          rows.push({
            id: newId("match"),
            competitionId: g.competitionId,
            tenantId: g.tenantId,
            teamAId: loserId(round[0]),
            teamBId: loserId(round[1]),
            discipline: g.discipline,
            status: "SCHEDULED",
            roundName: "3rd Place",
            matchNumber: n++,
          });
        }
        if (rows.length > 0) {
          await tx.insert(matches).values(rows);
          created = true;
        }
        break; // re-query and continue from the loop
      }

      if (!created) break;
    }
  });

  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
}
