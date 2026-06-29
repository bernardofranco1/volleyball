"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ADMIN_ROLES, SCORING_ROLES, authorizeMatch } from "@/lib/authz";
import { fail, OK, type FormState } from "@/lib/action-state";
import { scorerPinCookie } from "@/lib/scorer-pin";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Scorer enters the PIN; on success set a 12h cookie and reload the scorer. */
export async function verifyScorerPin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = s(fd, "matchId");
  const authed = await authorizeMatch(matchId, SCORING_ROLES);
  if (!authed.ok) return fail("Not allowed.");

  const rows = await db
    .select({ pin: matches.scorerPin })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const stored = rows[0]?.pin ?? null;
  if (!stored || s(fd, "pin") !== stored) return fail("Incorrect PIN.");

  (await cookies()).set(scorerPinCookie(matchId), stored, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  // redirect() throws NEXT_REDIRECT — must be outside any try/catch.
  redirect(
    `/t/${s(fd, "tenantSlug")}/competitions/${s(fd, "competitionId")}/matches/${matchId}/live`,
  );
}

/** Admin generates/rotates the match's 6-digit PIN. */
export async function generateScorerPin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = s(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Not allowed.");

  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(matches).set({ scorerPin: pin }).where(eq(matches.id, matchId));
  revalidatePath(
    `/t/${s(fd, "tenantSlug")}/competitions/${s(fd, "competitionId")}/matches/${matchId}`,
  );
  return OK;
}
