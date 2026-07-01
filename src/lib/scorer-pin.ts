import crypto from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";

// Per-match 6-digit scorer PIN (brief §5.2), mirroring the team-tablet token
// model: an extra gate on top of admin login. Opt-in per match — a match with
// no PIN set has the gate disabled (so existing matches aren't locked out).

export const scorerPinCookie = (matchId: string) => `vbpin_${matchId}`;

/**
 * Cookie value: HMAC(matchId:pin) — the raw PIN never leaves the server in a
 * cookie, and rotating the PIN invalidates outstanding cookies. Keyed off the
 * service-role key (already secret + present in every environment).
 */
export function scorerPinCookieValue(matchId: string, pin: string): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.DATABASE_URL ?? "dev";
  return crypto
    .createHmac("sha256", key)
    .update(`${matchId}:${pin}`)
    .digest("hex");
}

export async function getScorerPin(matchId: string): Promise<string | null> {
  const rows = await db
    .select({ pin: matches.scorerPin })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  return rows[0]?.pin ?? null;
}

/** True if the match has no PIN (gate off) or the caller's cookie matches it. */
export async function scorerPinSatisfied(matchId: string): Promise<boolean> {
  const pin = await getScorerPin(matchId);
  if (!pin) return true;
  const c = (await cookies()).get(scorerPinCookie(matchId))?.value;
  return c === scorerPinCookieValue(matchId, pin);
}
