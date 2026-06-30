"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionBranding, tournamentConfig } from "@/db/schema";
import type { Discipline } from "@/engine/types";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, type FormState } from "@/lib/action-state";

const DISCIPLINES: Discipline[] = ["BEACH", "INDOOR", "GRASS", "LIGHT"];
const GENDERS = ["MEN", "WOMEN", "MIXED", "UNSPECIFIED"] as const;
const STATUSES = ["DRAFT", "ACTIVE", "FINISHED"] as const;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
/** A date input value, or null when blank. Drizzle `date` columns use string mode. */
function dateOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v || null;
}
/** A positive integer override, or null to fall back to the discipline default. */
function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Create a competition + its (override) tournament_config row, then open it. */
export async function createCompetition(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);

  const name = str(fd, "name");
  const discipline = str(fd, "discipline") as Discipline;
  const gender = str(fd, "gender") || "UNSPECIFIED";

  if (!name) return fail("Name is required.");
  if (!DISCIPLINES.includes(discipline)) return fail("Pick a discipline.");
  if (!GENDERS.includes(gender as (typeof GENDERS)[number]))
    return fail("Invalid gender.");

  const id = newId("comp");
  await db.insert(competitions).values({
    id,
    tenantId: ctx.tenant.id,
    name,
    discipline,
    gender: gender as (typeof GENDERS)[number],
    startDate: dateOrNull(fd, "startDate"),
    endDate: dateOrNull(fd, "endDate"),
    venue: str(fd, "venue") || null,
    status: "DRAFT",
  });

  // Empty override row — nulls mean "use discipline defaults" (src/engine/config).
  await db.insert(tournamentConfig).values({
    competitionId: id,
    bestOf: intOrNull(fd, "bestOf"),
    setScore: intOrNull(fd, "setScore"),
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

/** Edit a competition's descriptive fields (DRAFT/ACTIVE — name/venue/dates). */
export async function updateCompetition(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);

  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return fail("Competition not found.");

  const name = str(fd, "name");
  if (!name) return fail("Name is required.");

  await db
    .update(competitions)
    .set({
      name,
      venue: str(fd, "venue") || null,
      startDate: dateOrNull(fd, "startDate"),
      endDate: dateOrNull(fd, "endDate"),
    })
    .where(eq(competitions.id, competitionId));

  revalidatePath(`/t/${tenantSlug}/competitions/${competitionId}`);
  redirect(`/t/${tenantSlug}/competitions/${competitionId}`);
}

/** Move a competition through DRAFT → ACTIVE → FINISHED (or archive back). */
export async function setCompetitionStatus(fd: FormData): Promise<void> {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const status = str(fd, "status");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return;

  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return;

  await db
    .update(competitions)
    .set({ status: status as (typeof STATUSES)[number] })
    .where(eq(competitions.id, competitionId));

  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: `competition.status.${status.toLowerCase()}`,
    entityType: "competition",
    entityId: competitionId,
    summary: `Set “${comp.name}” to ${status}`,
    metadata: { from: comp.status, to: status },
  });

  revalidatePath(`/t/${tenantSlug}/competitions`);
  revalidatePath(`/t/${tenantSlug}/competitions/${competitionId}`);
}

/** Persist scoring-rule overrides from the config panel. */
export async function updateCompetitionConfig(fd: FormData): Promise<void> {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);

  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return;

  await db
    .update(tournamentConfig)
    .set({
      bestOf: intOrNull(fd, "bestOf"),
      setScore: intOrNull(fd, "setScore"),
      setScoreTiebreak: intOrNull(fd, "setScoreTiebreak"),
      playersPerSide: intOrNull(fd, "playersPerSide"),
      serveClockEnabled: fd.get("serveClockEnabled") != null,
      ttoEnabled: fd.get("ttoEnabled") != null,
    })
    .where(eq(tournamentConfig.competitionId, competitionId));

  revalidatePath(`/t/${tenantSlug}/competitions/${competitionId}`);
}

/** Persist scoreboard appearance overrides from the Scoreboard config tab. */
export async function updateCompetitionBranding(fd: FormData): Promise<void> {
  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  const ctx = await requireRole(tenantSlug, ADMIN_ROLES);
  const comp = await getCompetition(ctx.tenant.id, competitionId);
  if (!comp) return;

  const v = (k: string) => str(fd, k) || null;
  const values = {
    bgColor: v("bgColor"),
    lineColor: v("lineColor"),
    accentColor: v("accentColor"),
    fontColor: v("fontColor"),
    fontFamily: v("fontFamily"),
    logoUrl: v("logoUrl"),
  };
  await db
    .insert(competitionBranding)
    .values({ competitionId, ...values })
    .onConflictDoUpdate({
      target: competitionBranding.competitionId,
      set: values,
    });

  revalidatePath(`/t/${tenantSlug}/competitions/${competitionId}`);
}
