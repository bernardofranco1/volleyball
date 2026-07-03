"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ADMIN_ROLES, SCORING_ROLES, authorizeMatch } from "@/lib/authz";
import { fail, ok, type FormState } from "@/lib/action-state";
import { rateLimitAuth } from "@/lib/ratelimit";
import {
  getScorerPin,
  scorerPinCookie,
  scorerPinCookieValue,
} from "@/lib/scorer-pin";
import { str } from "@/lib/form-data";

/** Scorer enters the PIN; on success set a 12h cookie and reload the scorer. */
export async function verifyScorerPin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, SCORING_ROLES);
  if (!authed.ok) return fail("Not allowed.");

  // Throttle guesses per user+match — a 6-digit PIN must not be brute-forceable.
  if (!(await rateLimitAuth(`pin:${authed.auth.user.id}:${matchId}`)))
    return fail("Too many attempts — wait a minute and try again.");

  const stored = await getScorerPin(matchId);
  const submitted = str(fd, "pin");
  if (
    !stored ||
    submitted.length !== stored.length ||
    !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(stored))
  )
    return fail("Incorrect PIN.");

  // Cookie carries an HMAC of the PIN, not the PIN itself.
  (await cookies()).set(
    scorerPinCookie(matchId),
    scorerPinCookieValue(matchId, stored),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    },
  );
  // redirect() throws NEXT_REDIRECT — must be outside any try/catch.
  redirect(
    `/t/${str(fd, "tenantSlug")}/competitions/${str(fd, "competitionId")}/matches/${matchId}/live`,
  );
}

/** Admin generates/rotates the match's 6-digit PIN. */
export async function generateScorerPin(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Not allowed.");

  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(matches).set({ scorerPin: pin }).where(eq(matches.id, matchId));
  revalidatePath(
    `/t/${str(fd, "tenantSlug")}/competitions/${str(fd, "competitionId")}/matches/${matchId}`,
  );
  return ok("New PIN generated — scorers must re-enter it.");
}
