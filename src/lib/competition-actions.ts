"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionBranding, tournamentConfig } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { gateCompetition } from "@/lib/action-gate";
import { BOARD_FONTS } from "@/lib/board-theme";
import { normalizeHex } from "@/lib/colors";
import {
  PLAYERS_PER_SIDE,
  canTransition,
  isCompetitionStatus,
  isDiscipline,
  isGender,
  type Gender,
} from "@/lib/domain";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, ok, type FormState } from "@/lib/action-state";
import { boolOrNull, dateOrNull, intOrNull, str } from "@/lib/form-data";

/** Create a competition + its (override) tournament_config row, then open it. */
export async function createCompetition(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);

  const name = str(fd, "name");
  const discipline = str(fd, "discipline");
  const gender = str(fd, "gender") || "UNSPECIFIED";

  if (!name) return fail("Name is required.");
  if (!isDiscipline(discipline)) return fail("Pick a discipline.");
  if (!isGender(gender)) return fail("Invalid gender.");

  const id = newId("comp");
  // One transaction: a competition without its config row would make the
  // Scoring-rules panel silently save nothing (config updates are upserts now,
  // but partial creation is still wrong).
  await db.transaction(async (tx) => {
    await tx.insert(competitions).values({
      id,
      tenantId: ctx.tenant.id,
      name,
      discipline,
      gender,
      startDate: dateOrNull(fd, "startDate"),
      endDate: dateOrNull(fd, "endDate"),
      venue: str(fd, "venue") || null,
      status: "DRAFT",
    });
    // Empty override row — nulls mean "use discipline defaults" (src/engine/config).
    await tx.insert(tournamentConfig).values({ competitionId: id });
  });

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "competition.create",
    entityType: "competition",
    entityId: id,
    summary: `Created ${discipline} competition “${name}”`,
  });

  revalidatePath(`/t/${tenantSlug}/competitions`);
  redirect(`/t/${tenantSlug}/competitions/${id}`);
}

/** Edit a competition's descriptive fields (name/venue/dates/gender). */
export async function updateCompetition(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const name = str(fd, "name");
  if (!name) return fail("Name is required.");
  const genderRaw = str(fd, "gender");
  let gender: Gender | undefined;
  if (genderRaw) {
    if (!isGender(genderRaw)) return fail("Invalid gender.");
    gender = genderRaw;
  }
  // Accent colour: blank clears it, a set value must be a valid hex (it's
  // injected as a background on the public/admin Matches page).
  const colorRaw = str(fd, "color");
  const color = colorRaw ? normalizeHex(colorRaw) : null;
  if (colorRaw && !color) return fail("Colour must be a hex value like #1a2b3c.");

  await db
    .update(competitions)
    .set({
      name,
      venue: str(fd, "venue") || null,
      startDate: dateOrNull(fd, "startDate"),
      endDate: dateOrNull(fd, "endDate"),
      color,
      ...(gender ? { gender } : {}),
    })
    .where(eq(competitions.id, g.competitionId));

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "competition.update",
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Edited competition details of “${name}”`,
  });

  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}`);
  return ok("Saved.");
}

/** Move a competition through DRAFT → ACTIVE → FINISHED (or reopen). */
export async function setCompetitionStatus(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");
  const status = str(fd, "status");
  if (!isCompetitionStatus(status)) return fail("Invalid status.");
  if (!canTransition(g.status, status))
    return fail(`Can't move from ${g.status} to ${status}.`);

  await db
    .update(competitions)
    .set({ status })
    .where(eq(competitions.id, g.competitionId));

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: `competition.status.${status.toLowerCase()}`,
    entityType: "competition",
    entityId: g.competitionId,
    summary: `Set competition to ${status}`,
    metadata: { from: g.status, to: status },
  });

  revalidatePath(`/t/${g.tenantSlug}/competitions`);
  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}`);
  return ok(`Competition is now ${status}.`);
}

/** Persist scoring-rule overrides from the config panel (validated, upsert). */
export async function updateCompetitionConfig(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  const bestOf = intOrNull(fd, "bestOf");
  if (bestOf != null && ![1, 3, 5].includes(bestOf))
    return fail("Best of must be 1, 3 or 5.");
  const setScore = intOrNull(fd, "setScore");
  if (setScore != null && (setScore < 1 || setScore > 99))
    return fail("Set score must be between 1 and 99.");
  const setScoreTiebreak = intOrNull(fd, "setScoreTiebreak");
  if (setScoreTiebreak != null && (setScoreTiebreak < 1 || setScoreTiebreak > 99))
    return fail("Tiebreak score must be between 1 and 99.");
  const playersPerSide = intOrNull(fd, "playersPerSide");
  if (playersPerSide != null) {
    const legal = PLAYERS_PER_SIDE[g.discipline];
    if (!legal)
      return fail("Players per side is fixed for this discipline.");
    if (!legal.includes(playersPerSide))
      return fail(`Players per side must be ${legal.join(" or ")}.`);
  }

  const timeoutsPerSet = intOrNull(fd, "timeoutsPerSet");
  if (timeoutsPerSet != null && (timeoutsPerSet < 0 || timeoutsPerSet > 9))
    return fail("Timeouts per set must be between 0 and 9.");
  const timeoutsPerSetTiebreak = intOrNull(fd, "timeoutsPerSetTiebreak");
  if (
    timeoutsPerSetTiebreak != null &&
    (timeoutsPerSetTiebreak < 0 || timeoutsPerSetTiebreak > 9)
  )
    return fail("Tie-break timeouts must be between 0 and 9.");
  const timeoutDurationSecs = intOrNull(fd, "timeoutDurationSecs");
  if (
    timeoutDurationSecs != null &&
    (timeoutDurationSecs < 5 || timeoutDurationSecs > 600)
  )
    return fail("Timeout duration must be between 5 and 600 seconds.");

  // Per-break set-break durations. Render as many inputs as (bestOf − 1); a fully
  // blank set means "use discipline defaults" (null), otherwise blanks fall back
  // to the discipline default for that break.
  const defaults = DISCIPLINE_DEFAULTS[g.discipline];
  const effBestOf = bestOf ?? defaults.bestOf;
  const nBreaks = Math.max(0, effBestOf - 1);
  const rawBreaks = Array.from({ length: nBreaks }, (_, i) =>
    intOrNull(fd, `setBreak_${i + 1}`),
  );
  let setBreakDurationsSecs: number[] | null = null;
  if (rawBreaks.some((v) => v != null)) {
    setBreakDurationsSecs = rawBreaks.map((v, i) => {
      const val = v ?? defaults.setBreakDurationsSecs[i] ?? 60;
      return Math.min(3600, Math.max(0, val));
    });
  }

  const values = {
    bestOf,
    setScore,
    setScoreTiebreak,
    playersPerSide,
    timeoutsPerSet,
    timeoutsPerSetTiebreak,
    timeoutDurationSecs,
    setBreakDurationsSecs,
    // Tri-state: null = discipline default, true/false = explicit override.
    serveClockEnabled: boolOrNull(fd, "serveClockEnabled"),
    ttoEnabled: boolOrNull(fd, "ttoEnabled"),
  };
  // Upsert — a missing config row (legacy competitions) must not silently no-op.
  await db
    .insert(tournamentConfig)
    .values({ competitionId: g.competitionId, ...values })
    .onConflictDoUpdate({ target: tournamentConfig.competitionId, set: values });

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "competition.config.update",
    entityType: "competition",
    entityId: g.competitionId,
    summary: "Updated scoring rules",
    metadata: values,
  });

  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}`);
  return ok("Scoring rules saved.");
}

/** Persist scoreboard appearance overrides from the Scoreboard config tab. */
export async function updateCompetitionBranding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gateCompetition(fd);
  if (!g) return fail("Competition not found.");

  // Colours must be hex (they're injected into the public board's CSS), the
  // font must come from the known list, and the logo must be an http(s) URL.
  const color = (k: string): string | null | false => {
    const v = str(fd, k);
    if (!v) return null;
    return normalizeHex(v) ?? false;
  };
  const bgColor = color("bgColor");
  const lineColor = color("lineColor");
  const accentColor = color("accentColor");
  const fontColor = color("fontColor");
  if (bgColor === false || lineColor === false || accentColor === false || fontColor === false)
    return fail("Colours must be hex values like #1a2b3c.");

  const fontFamily = str(fd, "fontFamily") || null;
  if (fontFamily && !(BOARD_FONTS as readonly string[]).includes(fontFamily))
    return fail("Pick a font from the list.");

  const logoUrl = str(fd, "logoUrl") || null;
  if (logoUrl) {
    try {
      const u = new URL(logoUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      return fail("Logo must be an http(s) URL.");
    }
  }

  const values = { bgColor, lineColor, accentColor, fontColor, fontFamily, logoUrl };
  await db
    .insert(competitionBranding)
    .values({ competitionId: g.competitionId, ...values })
    .onConflictDoUpdate({
      target: competitionBranding.competitionId,
      set: values,
    });

  await recordAudit({
    tenantId: g.tenantId,
    actor: g.actor,
    action: "competition.branding.update",
    entityType: "competition",
    entityId: g.competitionId,
    summary: "Updated scoreboard appearance",
  });

  revalidatePath(`/t/${g.tenantSlug}/competitions/${g.competitionId}`);
  updateTag(`competition-branding:${g.competitionId}`);
  return ok("Scoreboard appearance saved.");
}
