"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { ADMIN_ROLES, authorizeMatch } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  MatchNotFoundError,
  RewindRejectedError,
  UnsupportedDisciplineError,
  rewindMatch,
} from "@/lib/match-engine";
import { fail, ok, type FormState } from "@/lib/action-state";
import { intOrNull, str } from "@/lib/form-data";

/**
 * Rewind a match to just before a chosen event and let scoring resume manually
 * from there (spec/17). Any admin (Competition or Tenant) may do this, in any
 * state — a FINISHED match returns to LIVE. Scorers cannot rewind.
 */
export async function rewindMatchAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Only a competition admin can rewind a match.");

  const fromSequence = intOrNull(fd, "fromSequence");
  if (fromSequence == null) return fail("Pick a point to rewind to.");

  try {
    const { state } = await rewindMatch(matchId, fromSequence, {
      actor: "SCORER",
      deviceInfo: authed.auth.user.id,
    });
    await recordAudit({
      tenantId: authed.auth.tenantId,
      actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
      action: "match.rewind",
      entityType: "match",
      entityId: matchId,
      summary: `Rewound match to before event #${fromSequence}`,
      metadata: { fromSequence, resultingSequence: state.lastSequence },
    });
  } catch (err) {
    if (err instanceof RewindRejectedError) return fail(err.message);
    if (err instanceof MatchNotFoundError) return fail("Match not found.");
    if (err instanceof UnsupportedDisciplineError)
      return fail("This discipline can't be rewound.");
    throw err;
  }

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  if (tenantSlug && competitionId) {
    const base = `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`;
    revalidatePath(base);
    revalidatePath(`${base}/live`);
  }
  return ok("Match rewound — scoring can resume from that point.");
}

/**
 * Manager confirmation of a final result (spec/17, feature 5): flips a match
 * parked at PENDING_CONFIRMATION to FINISHED. Only a manager (Competition or
 * Tenant Admin) may confirm; scorers cannot. No event is appended — the
 * MATCH_END event already exists; this only finalises the workflow status
 * (and standings/brackets, which exclude non-FINISHED matches, now count it).
 */
export async function confirmMatchResult(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Only a competition admin can confirm a result.");

  const row = (
    await db
      .select({ status: matches.status, competitionId: matches.competitionId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  if (!row) return fail("Match not found.");
  if (row.status !== "PENDING_CONFIRMATION")
    return fail("This match isn't awaiting confirmation.");

  await db
    .update(matches)
    .set({ status: "FINISHED", finishedAt: new Date() })
    .where(eq(matches.id, matchId));

  await recordAudit({
    tenantId: authed.auth.tenantId,
    actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
    action: "match.confirmResult",
    entityType: "match",
    entityId: matchId,
    summary: "Confirmed the final result",
  });

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  if (tenantSlug && competitionId) {
    const base = `/t/${tenantSlug}/competitions/${competitionId}`;
    revalidatePath(`${base}/matches/${matchId}`);
    revalidatePath(`${base}/standings`);
    revalidatePath(`/t/${tenantSlug}/matches`);
    revalidatePath(`/t/${tenantSlug}/scoreboard/${matchId}`);
  }
  return ok("Result confirmed.");
}
