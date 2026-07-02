"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, pools, teams } from "@/db/schema";
import { gateCompetition } from "@/lib/action-gate";
import { computeStandings } from "@/lib/standings";
import { recordAudit } from "@/lib/audit";
import {
  bracketSize,
  isKnockoutRound,
  roundLabel,
  seedOrder,
} from "@/lib/bracket";
import { newId } from "@/lib/id";
import { nextMatchNumber } from "@/lib/match-number";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";

function standingsPath(tenantSlug: string, competitionId: string) {
  return `/t/${tenantSlug}/competitions/${competitionId}/standings`;
}

// ── Pools ─────────────────────────────────────────────────────────────────────

export async function createPool(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const name = str(fd, "name");
  if (!name) return fail("Pool name is required.");

  const dup = await db
    .select({ id: pools.id })
    .from(pools)
    .where(and(eq(pools.competitionId, g.competitionId), eq(pools.name, name)))
    .limit(1);
  if (dup.length > 0) return fail(`Pool “${name}” already exists.`);

  await db.insert(pools).values({
    id: newId("pool"),
    competitionId: g.competitionId,
    tenantId: g.tenantId,
    name,
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok(`Created pool ${name}.`);
}

export async function renamePool(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const poolId = str(fd, "poolId");
  const name = str(fd, "name");
  if (!poolId || !name) return fail("Pool name is required.");

  await db
    .update(pools)
    .set({ name })
    .where(and(eq(pools.id, poolId), eq(pools.competitionId, g.competitionId)));
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok("Pool renamed.");
}

/** Delete a pool; its teams become unpooled (assignments are cleared first). */
export async function deletePool(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const poolId = str(fd, "poolId");
  if (!poolId) return fail("Missing pool.");

  await db.transaction(async (tx) => {
    await tx
      .update(teams)
      .set({ poolId: null })
      .where(
        and(eq(teams.poolId, poolId), eq(teams.competitionId, g.competitionId)),
      );
    await tx
      .delete(pools)
      .where(and(eq(pools.id, poolId), eq(pools.competitionId, g.competitionId)));
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok("Pool deleted — its teams are now unpooled.");
}

/** Assign (or clear, when poolId is empty) a team's pool. */
export async function assignTeamPool(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const teamId = str(fd, "teamId");
  const poolId = str(fd, "poolId") || null;
  if (!teamId) return fail("Missing team.");
  // A non-empty pool must belong to this competition (spec/14 §E4) — otherwise
  // a crafted poolId could attach a team to a foreign competition's pool.
  if (poolId) {
    const valid = await db
      .select({ id: pools.id })
      .from(pools)
      .where(and(eq(pools.id, poolId), eq(pools.competitionId, g.competitionId)))
      .limit(1);
    if (valid.length === 0) return fail("Pool not found.");
  }
  await db
    .update(teams)
    .set({ poolId })
    .where(and(eq(teams.id, teamId), eq(teams.competitionId, g.competitionId)));
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok("Saved.");
}

/**
 * Save every team's pool assignment in one submit. Reads one `pool-<teamId>`
 * select per team — replaces the per-team "Set" round trips.
 */
export async function savePoolAssignments(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const [teamRows, poolRows] = await Promise.all([
    db
      .select({ id: teams.id, poolId: teams.poolId })
      .from(teams)
      .where(eq(teams.competitionId, g.competitionId)),
    db
      .select({ id: pools.id })
      .from(pools)
      .where(eq(pools.competitionId, g.competitionId)),
  ]);
  const validPools = new Set(poolRows.map((p) => p.id));

  const changes: { teamId: string; poolId: string | null }[] = [];
  for (const t of teamRows) {
    const raw = fd.get(`pool-${t.id}`);
    if (raw == null) continue; // not on the form
    const poolId = String(raw) || null;
    if (poolId && !validPools.has(poolId)) continue;
    if (poolId !== t.poolId) changes.push({ teamId: t.id, poolId });
  }

  if (changes.length > 0) {
    await db.transaction(async (tx) => {
      for (const c of changes) {
        await tx
          .update(teams)
          .set({ poolId: c.poolId })
          .where(
            and(
              eq(teams.id, c.teamId),
              eq(teams.competitionId, g.competitionId),
            ),
          );
      }
    });
  }
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok(
    changes.length > 0
      ? `Updated ${changes.length} assignment(s).`
      : "No changes.",
  );
}

/**
 * Distribute all teams into the competition's pools by seed, serpentine
 * (1→A, 2→B, 3→B, 4→A for two pools) so pool strength stays balanced.
 * Overwrites existing assignments.
 */
export async function distributePoolsBySeed(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const [teamRows, poolRows] = await Promise.all([
    db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.competitionId, g.competitionId))
      .orderBy(asc(teams.seed), asc(teams.displayName)),
    db
      .select({ id: pools.id, name: pools.name })
      .from(pools)
      .where(eq(pools.competitionId, g.competitionId))
      .orderBy(asc(pools.name)),
  ]);
  if (poolRows.length < 2) return fail("Create at least two pools first.");
  if (teamRows.length === 0) return fail("No teams to distribute.");

  const k = poolRows.length;
  await db.transaction(async (tx) => {
    for (let i = 0; i < teamRows.length; i++) {
      // Serpentine: rows of k seeds alternate direction.
      const row = Math.floor(i / k);
      const posInRow = i % k;
      const poolIdx = row % 2 === 0 ? posInRow : k - 1 - posInRow;
      await tx
        .update(teams)
        .set({ poolId: poolRows[poolIdx].id })
        .where(eq(teams.id, teamRows[i].id));
    }
  });

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "pool.distribute",
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Distributed ${teamRows.length} teams into ${k} pools by seed (serpentine)`,
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok(`Distributed ${teamRows.length} teams into ${k} pools.`);
}

// ── Knockout bracket ───────────────────────────────────────────────────────────

/**
 * Seed the largest power-of-two field by team seed and create round 1. Wrapped in
 * a per-competition advisory lock so concurrent clicks can't double-generate
 * (spec/14 §E1); a partial unique index on (competition, round, match#) backstops.
 */
export async function generateBracket(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  let outcome: FormState = ok("Bracket generated.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${g.competitionId}))`);

    const existing = await tx
      .select({ roundName: matches.roundName })
      .from(matches)
      .where(eq(matches.competitionId, g.competitionId))
      .limit(500);
    if (existing.some((m) => isKnockoutRound(m.roundName))) {
      outcome = fail("A bracket already exists for this competition.");
      return;
    }

    const teamRows = await tx
      .select({ id: teams.id, seed: teams.seed, displayName: teams.displayName })
      .from(teams)
      .where(eq(teams.competitionId, g.competitionId))
      .orderBy(asc(teams.seed), asc(teams.displayName));
    if (teamRows.length < 2) {
      outcome = fail("Add at least two teams before seeding a bracket.");
      return;
    }

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
    outcome = ok(`Seeded a ${label} bracket (${rows.length} matches).`);
  });
  if (outcome.error) return outcome;

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "bracket.generate",
    entityType: "competition",
    entityId: g.competitionId,
    summary: "Generated single-elimination bracket",
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return outcome;
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
export async function advanceBracket(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  let createdTotal = 0;
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
          createdTotal += rows.length;
          created = true;
        }
        break; // re-query and continue from the loop
      }

      if (!created) break;
    }
  });

  if (createdTotal === 0)
    return ok("Nothing to advance yet — finish the current round first.");

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "bracket.advance",
    entityType: "competition",
    entityId: g.competitionId,
    summary: "Advanced bracket winners",
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok(`Created ${createdTotal} next-round match(es).`);
}

/**
 * Write the Seed column from current standings, so the bracket can be
 * generated from pool results without retyping seeds. Rank-major across
 * pools: every pool winner first (pools in name order), then the runners-up,
 * and so on — the standard cross-pool seeding.
 */
export async function seedFromStandings(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const groups = await computeStandings(g.competitionId);
  const ranked: string[] = [];
  const maxRank = Math.max(0, ...groups.map((gr) => gr.rows.length));
  for (let r = 0; r < maxRank; r++) {
    for (const gr of groups) {
      const row = gr.rows[r];
      if (row) ranked.push(row.teamId);
    }
  }
  if (ranked.length === 0) return fail("No standings yet to seed from.");

  await db.transaction(async (tx) => {
    for (let i = 0; i < ranked.length; i++) {
      await tx
        .update(teams)
        .set({ seed: i + 1 })
        .where(
          and(eq(teams.id, ranked[i]), eq(teams.competitionId, g.competitionId)),
        );
    }
  });

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "bracket.seed_from_standings",
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Seeded ${ranked.length} teams from standings`,
  });
  revalidatePath(standingsPath(g.tenantSlug, g.competitionId));
  return ok(`Seeded ${ranked.length} teams from standings — now generate the bracket.`);
}
