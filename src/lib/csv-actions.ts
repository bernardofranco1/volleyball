"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { csvImports, matches, players, teams } from "@/db/schema";
import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { csvBool, parseCsvRecords } from "@/lib/csv";
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

async function readFile(fd: FormData): Promise<string | null> {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return null;
  return f.text();
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
}

/** teams.csv → displayName,countryCode,clubName,seed */
export async function importTeams(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gate(fd);
  if (!g) return { error: "Competition not found." };
  const text = await readFile(fd);
  if (text == null) return { error: "Choose a CSV file." };

  const { records } = parseCsvRecords(text);
  const errs: string[] = [];
  let ok = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const displayName = (r.displayName ?? "").trim();
    if (!displayName) {
      errs.push(`Row ${i + 2}: missing displayName`);
      continue;
    }
    try {
      await db.insert(teams).values({
        id: newId("team"),
        competitionId: g.competitionId,
        tenantId: g.tenantId,
        displayName,
        countryCode: (r.countryCode || "").toUpperCase() || null,
        clubName: r.clubName || null,
        seed: intOrNull(r.seed),
      });
      ok++;
    } catch {
      errs.push(`Row ${i + 2}: failed to insert "${displayName}"`);
    }
  }

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
  const text = await readFile(fd);
  if (text == null) return { error: "Choose a CSV file." };

  const teamRows = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const byName = new Map(
    teamRows.map((t) => [t.displayName.toLowerCase(), t.id]),
  );

  const { records } = parseCsvRecords(text);
  const errs: string[] = [];
  let ok = 0;
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
    try {
      await db.insert(players).values({
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
      ok++;
    } catch {
      errs.push(`Row ${i + 2}: failed to insert "${fullName}"`);
    }
  }

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
  const text = await readFile(fd);
  if (text == null) return { error: "Choose a CSV file." };

  const teamRows = await db
    .select({ id: teams.id, displayName: teams.displayName })
    .from(teams)
    .where(eq(teams.competitionId, g.competitionId));
  const byName = new Map(
    teamRows.map((t) => [t.displayName.toLowerCase(), t.id]),
  );

  const { records } = parseCsvRecords(text);
  const errs: string[] = [];
  let ok = 0;
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
      const d = new Date(r.scheduledAt);
      if (Number.isNaN(d.getTime())) {
        errs.push(`Row ${i + 2}: invalid date "${r.scheduledAt}"`);
        continue;
      }
      when = d;
    }
    try {
      await db.insert(matches).values({
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
      ok++;
    } catch {
      errs.push(`Row ${i + 2}: failed to insert match`);
    }
  }

  await logImport(g.tenantId, "SCHEDULE", fileName(fd), g.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/schedule`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

function fileName(fd: FormData): string | null {
  const f = fd.get("file");
  return f instanceof File ? f.name : null;
}
