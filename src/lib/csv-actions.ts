"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { csvImports, matches, players, teams } from "@/db/schema";
import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { csvBool, parseCsvRecords, recordGetter } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import type { ImportState } from "@/lib/action-state";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function intOrNull(v: string): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
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
    userId: ctx.user.id,
    discipline: comp.discipline as Discipline,
  };
}

// Cap admin CSV uploads so a huge file can't OOM the request (spec/14 §F5).
const MAX_CSV_BYTES = 512 * 1024;

async function readFile(
  fd: FormData,
): Promise<{ text: string } | { error: string }> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0)
    return { error: "Choose a CSV file." };
  if (f.size > MAX_CSV_BYTES) return { error: "File too large (max 512 KB)." };
  return { text: await f.text() };
}

/** One batched insert (spec/14 §F5). Returns rows written, or 0 on failure. */
async function bulkInsert(
  insert: () => Promise<unknown>,
  count: number,
  errs: string[],
): Promise<number> {
  if (count === 0) return 0;
  try {
    await insert();
    return count;
  } catch {
    errs.push("Bulk insert failed — check for duplicates or invalid values.");
    return 0;
  }
}

async function logImport(
  tenantId: string,
  importType: "TEAMS" | "PLAYERS" | "SCHEDULE" | "ROSTER",
  filename: string | null,
  createdBy: string,
  ok: number,
  errs: string[],
) {
  await db.insert(csvImports).values({
    id: newId("csv"),
    tenantId,
    importType,
    filename,
    rowsOk: ok,
    rowsError: errs.length,
    errors: errs.length ? errs : null,
    createdBy,
  });
  await recordAudit({
    tenantId,
    actor: { userId: createdBy },
    action: `csv.import.${importType.toLowerCase()}`,
    entityType: "import",
    summary: `Imported ${ok} ${importType.toLowerCase()} (${errs.length} skipped)${filename ? ` from ${filename}` : ""}`,
  });
}

/** teams.csv → displayName,countryCode,clubName,seed */
export async function importTeams(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gate(fd);
  if (!g) return { error: "Competition not found." };
  const file = await readFile(fd);
  if ("error" in file) return { error: file.error };

  const { records } = parseCsvRecords(file.text);
  const errs: string[] = [];
  const rows: (typeof teams.$inferInsert)[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const displayName = (r.displayName ?? "").trim();
    if (!displayName) {
      errs.push(`Row ${i + 2}: missing displayName`);
      continue;
    }
    rows.push({
      id: newId("team"),
      competitionId: g.competitionId,
      tenantId: g.tenantId,
      displayName,
      countryCode: (r.countryCode || "").toUpperCase() || null,
      clubName: r.clubName || null,
      seed: intOrNull(r.seed),
    });
  }
  const ok = await bulkInsert(() => db.insert(teams).values(rows), rows.length, errs);

  await logImport(g.tenantId, "TEAMS", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/teams`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

/** players.csv → teamDisplayName,firstName,lastName,jerseyNumber,isCaptain,isLibero */
export async function importPlayers(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gate(fd);
  if (!g) return { error: "Competition not found." };
  const file = await readFile(fd);
  if ("error" in file) return { error: file.error };

  const teamRows = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const byName = new Map(
    teamRows.map((t) => [t.displayName.toLowerCase(), t.id]),
  );

  const { records } = parseCsvRecords(file.text);
  const errs: string[] = [];
  const rows: (typeof players.$inferInsert)[] = [];
  // Jersey-uniqueness guard (brief §2.1): pre-validate against existing players
  // and within the batch so we report row numbers instead of a raw DB error.
  const teamIds = teamRows.map((t) => t.id);
  const existingJerseys = new Set(
    teamIds.length
      ? (
          await db
            .select({
              teamId: players.teamId,
              jerseyNumber: players.jerseyNumber,
            })
            .from(players)
            .where(inArray(players.teamId, teamIds))
        )
          .filter((p) => p.jerseyNumber != null)
          .map((p) => `${p.teamId}:${p.jerseyNumber}`)
      : [],
  );
  const seenJerseys = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const teamName = (r.teamDisplayName ?? "").trim();
    const teamId = byName.get(teamName.toLowerCase());
    if (!teamId) {
      errs.push(`Row ${i + 2}: unknown team "${teamName}"`);
      continue;
    }
    const fullName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    if (!fullName) {
      errs.push(`Row ${i + 2}: missing player name`);
      continue;
    }
    const jerseyNumber = intOrNull(r.jerseyNumber);
    if (jerseyNumber != null) {
      const key = `${teamId}:${jerseyNumber}`;
      if (existingJerseys.has(key) || seenJerseys.has(key)) {
        errs.push(
          `Row ${i + 2}: duplicate jersey ${jerseyNumber} for team "${teamName}"`,
        );
        continue;
      }
      seenJerseys.add(key);
    }
    rows.push({
      id: newId("plyr"),
      teamId,
      tenantId: g.tenantId,
      firstName: r.firstName || null,
      lastName: r.lastName || null,
      fullName,
      jerseyNumber,
      isCaptain: csvBool(r.isCaptain),
      isLibero: csvBool(r.isLibero),
    });
  }
  const ok = await bulkInsert(() => db.insert(players).values(rows), rows.length, errs);

  await logImport(g.tenantId, "PLAYERS", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/teams`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

/** schedule.csv → matchNumber,teamA,teamB,courtNumber,scheduledAt,roundName */
export async function importSchedule(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gate(fd);
  if (!g) return { error: "Competition not found." };
  const file = await readFile(fd);
  if ("error" in file) return { error: file.error };

  const teamRows = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const byName = new Map(
    teamRows.map((t) => [t.displayName.toLowerCase(), t.id]),
  );

  const { records } = parseCsvRecords(file.text);
  const errs: string[] = [];
  const rows: (typeof matches.$inferInsert)[] = [];
  for (let i = 0; i < records.length; i++) {
    // Tolerant headers (brief §3.2): "Team A" / "teamA", "Match number" / …
    const get = recordGetter(records[i]);
    const nameA = get("Team A", "teamA");
    const nameB = get("Team B", "teamB");
    const a = byName.get(nameA.toLowerCase());
    const b = byName.get(nameB.toLowerCase());
    if (!a || !b) {
      errs.push(`Row ${i + 2}: unknown team(s) "${nameA}" / "${nameB}"`);
      continue;
    }
    if (a === b) {
      errs.push(`Row ${i + 2}: team cannot play itself`);
      continue;
    }
    // Accept a single "scheduledAt", or split "Match day" + "Match time (local)".
    const day = get("Match day", "matchDay", "date");
    const time = get("Match time (local)", "Match time", "matchTime", "time");
    const raw = get("scheduledAt") || (day ? `${day}T${time || "00:00"}` : "");
    let when: Date | null = null;
    if (raw) {
      // Zone-less times are treated as UTC (spec/14 §E2).
      const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(raw);
      const d = new Date(hasZone ? raw : `${raw}Z`);
      if (Number.isNaN(d.getTime())) {
        errs.push(`Row ${i + 2}: invalid date/time "${raw}"`);
        continue;
      }
      when = d;
    }
    rows.push({
      id: newId("match"),
      competitionId: g.competitionId,
      tenantId: g.tenantId,
      teamAId: a,
      teamBId: b,
      discipline: g.discipline,
      status: "SCHEDULED",
      courtNumber: intOrNull(get("Court number", "courtNumber")),
      scheduledAt: when,
      roundName: get("roundName", "round") || null,
      matchNumber: intOrNull(get("Match number", "matchNumber")),
      groupName: get("Group", "group", "groupName") || null,
      phaseNumber: intOrNull(get("Phase number", "phaseNumber")),
      phaseName: get("Phase name", "phaseName") || null,
    });
  }
  const ok = await bulkInsert(() => db.insert(matches).values(rows), rows.length, errs);

  await logImport(g.tenantId, "SCHEDULE", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/schedule`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

/**
 * Merged teams + players import (brief §3.1): one CSV where each row is a player
 * with their team name; teams are created on first sight. The FIRST data row is
 * a worked example ("John Doe") and is ignored. Columns (tolerant headers):
 * Team, First name, Last name, Jersey, Captain, Libero (+ optional Country,
 * Club, Seed). Jersey numbers stay unique per team (brief §2.1).
 */
export async function importRoster(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gate(fd);
  if (!g) return { error: "Competition not found." };
  const file = await readFile(fd);
  if ("error" in file) return { error: file.error };

  const { records } = parseCsvRecords(file.text);
  // Drop the first data row — it's the ignored example.
  const dataRows = records.slice(1);

  const existingTeams = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const teamIdByName = new Map(
    existingTeams.map((t) => [t.displayName.toLowerCase(), t.id]),
  );
  const existingJerseys = new Set(
    existingTeams.length
      ? (
          await db
            .select({
              teamId: players.teamId,
              jerseyNumber: players.jerseyNumber,
            })
            .from(players)
            .where(inArray(players.teamId, [...teamIdByName.values()]))
        )
          .filter((p) => p.jerseyNumber != null)
          .map((p) => `${p.teamId}:${p.jerseyNumber}`)
      : [],
  );
  const seenJerseys = new Set<string>();

  const newTeams: (typeof teams.$inferInsert)[] = [];
  const newPlayers: (typeof players.$inferInsert)[] = [];
  const errs: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const get = recordGetter(dataRows[i]);
    const rowNo = i + 3; // header + ignored example + 1-based
    const teamName = get("Team", "Team name", "teamDisplayName", "displayName");
    if (!teamName) {
      errs.push(`Row ${rowNo}: missing team`);
      continue;
    }
    let teamId = teamIdByName.get(teamName.toLowerCase());
    if (!teamId) {
      teamId = newId("team");
      teamIdByName.set(teamName.toLowerCase(), teamId);
      newTeams.push({
        id: teamId,
        competitionId: g.competitionId,
        tenantId: g.tenantId,
        displayName: teamName,
        countryCode: (get("Country", "countryCode") || "").toUpperCase() || null,
        clubName: get("Club", "clubName") || null,
        seed: intOrNull(get("Seed", "seed")),
      });
    }
    const firstName = get("First name", "firstName");
    const lastName = get("Last name", "lastName");
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!fullName) {
      errs.push(`Row ${rowNo}: missing player name`);
      continue;
    }
    const jerseyNumber = intOrNull(
      get("Jersey", "Jersey number", "jerseyNumber", "number"),
    );
    if (jerseyNumber != null) {
      const key = `${teamId}:${jerseyNumber}`;
      if (existingJerseys.has(key) || seenJerseys.has(key)) {
        errs.push(
          `Row ${rowNo}: duplicate jersey ${jerseyNumber} for team "${teamName}"`,
        );
        continue;
      }
      seenJerseys.add(key);
    }
    newPlayers.push({
      id: newId("plyr"),
      teamId,
      tenantId: g.tenantId,
      firstName: firstName || null,
      lastName: lastName || null,
      fullName,
      jerseyNumber,
      isCaptain: csvBool(get("Captain", "isCaptain")),
      isLibero: csvBool(get("Libero", "isLibero")),
    });
  }

  // Teams first (players FK them), then players.
  if (newTeams.length)
    await bulkInsert(() => db.insert(teams).values(newTeams), newTeams.length, errs);
  const ok = newPlayers.length
    ? await bulkInsert(
        () => db.insert(players).values(newPlayers),
        newPlayers.length,
        errs,
      )
    : 0;

  await logImport(g.tenantId, "ROSTER", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/teams`);
  return {
    error: null,
    summary: {
      ok,
      errors: errs.length,
      messages: [
        ...(newTeams.length ? [`${newTeams.length} new team(s) created`] : []),
        ...errs,
      ],
    },
  };
}

function fileName(fd: FormData): string | null {
  const f = fd.get("file");
  return f instanceof File ? f.name : null;
}
