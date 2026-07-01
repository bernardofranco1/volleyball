"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { csvImports, matches, players, teams } from "@/db/schema";
import { gateCompetition } from "@/lib/action-gate";
import { csvBool, parseCsvRecords, recordGetter } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import type { ImportState } from "@/lib/action-state";

function intFrom(v: string): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
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

/** Human-readable reason from a failed bulk insert (constraint name + detail). */
function dbErrorDetail(e: unknown): string {
  if (e && typeof e === "object") {
    const pg = e as { constraint_name?: string; detail?: string; message?: string };
    const parts = [pg.constraint_name, pg.detail ?? pg.message].filter(Boolean);
    if (parts.length) return parts.join(": ");
  }
  return "check for duplicates or invalid values";
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
  } catch (e) {
    errs.push(`Bulk insert failed — ${dbErrorDetail(e)}.`);
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

/** schedule.csv → matchNumber,teamA,teamB,courtNumber,scheduledAt,roundName */
export async function importSchedule(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gateCompetition(fd);
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
      courtNumber: intFrom(get("Court number", "courtNumber")),
      scheduledAt: when,
      roundName: get("roundName", "round") || null,
      matchNumber: intFrom(get("Match number", "matchNumber")),
      groupName: get("Group", "group", "groupName") || null,
      phaseNumber: intFrom(get("Phase number", "phaseNumber")),
      phaseName: get("Phase name", "phaseName") || null,
    });
  }
  const ok = await bulkInsert(() => db.insert(matches).values(rows), rows.length, errs);

  await logImport(g.tenantId, "SCHEDULE", fileName(fd), g.actor.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/schedule`);
  return { error: null, summary: { ok, errors: errs.length, messages: errs } };
}

/**
 * True when a roster row matches the template's worked example ("John Doe" on
 * "Example Team") — those are skipped by content, not by position, so a clean
 * file no longer silently loses its first player.
 */
function isExampleRow(get: (...names: string[]) => string): boolean {
  const first = get("First name", "firstName").toLowerCase();
  const last = get("Last name", "lastName").toLowerCase();
  const team = get("Team", "Team name", "teamDisplayName", "displayName").toLowerCase();
  return (
    (first === "john" && last === "doe") ||
    team === "example team" ||
    team === "example"
  );
}

/**
 * Merged teams + players import (brief §3.1): one CSV where each row is a player
 * with their team name; teams are created on first sight. Rows matching the
 * template's worked example ("John Doe") are ignored. Columns (tolerant
 * headers): Team, First name, Last name, Jersey, Captain, Libero (+ optional
 * Country, Club, Seed). Jersey numbers stay unique per team (brief §2.1).
 * Teams and players are written in ONE transaction — a failure rolls back both.
 */
export async function importRoster(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  const g = await gateCompetition(fd);
  if (!g) return { error: "Competition not found." };
  const file = await readFile(fd);
  if ("error" in file) return { error: file.error };

  const { records } = parseCsvRecords(file.text);

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
  let exampleRows = 0;

  for (let i = 0; i < records.length; i++) {
    const get = recordGetter(records[i]);
    const rowNo = i + 2; // 1-based + header row
    if (isExampleRow(get)) {
      exampleRows++;
      continue;
    }
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
        seed: intFrom(get("Seed", "seed")),
        color: get("Color", "colour", "color") || null,
      });
    }
    const firstName = get("First name", "firstName");
    const lastName = get("Last name", "lastName");
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!fullName) {
      errs.push(`Row ${rowNo}: missing player name`);
      continue;
    }
    const jerseyNumber = intFrom(
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

  // Teams first (players FK them), then players — one transaction, so a
  // player-insert failure doesn't leave half-created teams behind.
  let ok = 0;
  if (newTeams.length || newPlayers.length) {
    try {
      await db.transaction(async (tx) => {
        if (newTeams.length) await tx.insert(teams).values(newTeams);
        if (newPlayers.length) await tx.insert(players).values(newPlayers);
      });
      ok = newPlayers.length;
    } catch (e) {
      errs.push(`Import failed — ${dbErrorDetail(e)}.`);
    }
  }

  await logImport(g.tenantId, "ROSTER", fileName(fd), g.actor.userId, ok, errs);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}/teams`);
  return {
    error: null,
    summary: {
      ok,
      errors: errs.length,
      messages: [
        ...(ok > 0 && newTeams.length
          ? [`${newTeams.length} new team(s) created`]
          : []),
        ...(exampleRows > 0 ? [`${exampleRows} example row(s) ignored`] : []),
        ...errs,
      ],
    },
  };
}

function fileName(fd: FormData): string | null {
  const f = fd.get("file");
  return f instanceof File ? f.name : null;
}
