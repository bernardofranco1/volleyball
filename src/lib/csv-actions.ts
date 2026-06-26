"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { csvImports, matches, players, teams } from "@/db/schema";
import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { csvBool, parseCsvRecords } from "@/lib/csv";
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
  importType: "TEAMS" | "PLAYERS" | "SCHEDULE",
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
    rows.push({
      id: newId("plyr"),
      teamId,
      tenantId: g.tenantId,
      firstName: r.firstName || null,
      lastName: r.lastName || null,
      fullName,
      jerseyNumber: intOrNull(r.jerseyNumber),
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
    const r = records[i];
    const a = byName.get((r.teamA ?? "").trim().toLowerCase());
    const b = byName.get((r.teamB ?? "").trim().toLowerCase());
    if (!a || !b) {
      errs.push(`Row ${i + 2}: unknown team(s) "${r.teamA}" / "${r.teamB}"`);
      continue;
    }
    if (a === b) {
      errs.push(`Row ${i + 2}: team cannot play itself`);
      continue;
    }
    let when: Date | null = null;
    if (r.scheduledAt) {
      // Zone-less times are treated as UTC (spec/14 §E2).
      const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(r.scheduledAt);
      const d = new Date(hasZone ? r.scheduledAt : `${r.scheduledAt}Z`);
      if (Number.isNaN(d.getTime())) {
        errs.push(`Row ${i + 2}: invalid date "${r.scheduledAt}"`);
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
      courtNumber: intOrNull(r.courtNumber),
      scheduledAt: when,
      roundName: r.roundName || null,
      matchNumber: intOrNull(r.matchNumber),
    });
  }
  const ok = await bulkInsert(() => db.insert(matches).values(rows), rows.length, errs);

  await logImport(g.tenantId, "SCHEDULE", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/schedule`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

function fileName(fd: FormData): string | null {
  const f = fd.get("file");
  return f instanceof File ? f.name : null;
}
