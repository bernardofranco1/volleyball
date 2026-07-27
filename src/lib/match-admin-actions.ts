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
  resolveMatchConfig,
  rewindMatch,
} from "@/lib/match-engine";
import {
  invalidateSignatures,
  loadSignatures,
  resultLocked,
  signatureProgress,
  signatureRoleLabel,
} from "@/lib/match-signatures";
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

  // A signed scoresheet must be reopened first — rewinding underneath three
  // signatures would leave them attesting to a result that no longer exists.
  if (await resultLocked(matchId))
    return fail(
      "The scoresheet is signed. Reopen the match first — that invalidates the signatures.",
    );

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

  // Where the competition obliges the scoresheet to be signed, a manager may
  // still confirm without it (broken tablet, retro data entry) — but the
  // override has to say why, and the reason goes on the record.
  const config = await resolveMatchConfig(matchId);
  const reason = str(fd, "reason");
  let overrideOf: string[] = [];
  if (config.resultSignatures === "REQUIRED") {
    const signatures = await loadSignatures(matchId);
    const { missing } = signatureProgress(signatures, null);
    overrideOf = missing;
    if (missing.length > 0 && reason.trim().length < 3)
      return fail(
        `The scoresheet is not signed (missing: ${missing
          .map(signatureRoleLabel)
          .join(", ")}). Give a reason to confirm without signatures.`,
      );
  }

  const now = new Date();
  await db
    .update(matches)
    .set({
      status: "FINISHED",
      finishedAt: now,
      confirmedAt: now,
      confirmedBy: authed.auth.user.id,
      confirmedVia: "ADMIN",
    })
    .where(eq(matches.id, matchId));

  await recordAudit({
    tenantId: authed.auth.tenantId,
    actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
    action: "match.confirmResult",
    entityType: "match",
    entityId: matchId,
    summary:
      overrideOf.length > 0
        ? "Confirmed the final result without a signed scoresheet"
        : "Confirmed the final result",
    metadata: {
      via: "ADMIN",
      ...(overrideOf.length > 0
        ? { missingSignatures: overrideOf, reason: reason.trim() }
        : {}),
    },
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

/**
 * Reopen a confirmed result so it can be corrected (spec/20). A signed
 * scoresheet is locked against every further event, so this is the only way
 * back in — and it invalidates all three signatures, because they attested to
 * the result as it stood. The signatures themselves are retained forever
 * (marked invalid with this reason); re-signing starts from scratch, all three.
 */
export async function reopenMatchResult(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Only a competition admin can reopen a result.");

  const reason = str(fd, "reason").trim();
  if (reason.length < 3)
    return fail("Give a reason for reopening the result — it goes on the record.");

  const row = (
    await db
      .select({ status: matches.status, via: matches.confirmedVia })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  if (!row) return fail("Match not found.");
  if (row.status !== "FINISHED")
    return fail("Only a confirmed result can be reopened.");

  const invalidated = await invalidateSignatures(
    matchId,
    `Match reopened: ${reason}`,
  );
  await db
    .update(matches)
    .set({
      status: "PENDING_CONFIRMATION",
      finishedAt: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmedVia: null,
    })
    .where(eq(matches.id, matchId));

  await recordAudit({
    tenantId: authed.auth.tenantId,
    actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
    action: "match.reopen",
    entityType: "match",
    entityId: matchId,
    summary: `Reopened the confirmed result (${invalidated} signature(s) invalidated)`,
    metadata: { reason, invalidated, previousVia: row.via },
  });

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  if (tenantSlug && competitionId) {
    const base = `/t/${tenantSlug}/competitions/${competitionId}`;
    revalidatePath(`${base}/matches/${matchId}`);
    revalidatePath(`${base}/matches/${matchId}/live`);
    revalidatePath(`${base}/standings`);
    revalidatePath(`/t/${tenantSlug}/matches`);
    revalidatePath(`/t/${tenantSlug}/scoreboard/${matchId}`);
  }
  return ok(
    invalidated > 0
      ? `Result reopened — ${invalidated} signature(s) invalidated. The scoresheet must be signed again.`
      : "Result reopened.",
  );
}
