"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, dbTx } from "@/db";
import { matchOfficials, matches } from "@/db/schema";
import {
  ADMIN_ROLES,
  SCORING_ROLES,
  authorizeMatch,
  writerId,
  writerNote,
} from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { scheduleIncrementalBackup } from "@/lib/backup";
import {
  MatchNotFoundError,
  RewindRejectedError,
  UnsupportedDisciplineError,
  resolveMatchConfig,
  cancelPointsForFault,
  FaultCorrectionError,
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
import { newId } from "@/lib/id";
import { resolvePickedPerson } from "@/lib/people-actions";

/**
 * Correct a late-discovered positional fault (spec/29 F13): cancel the points
 * the faulting team scored while it was at fault. The opponent keeps
 * everything they scored in the same window, which is why this cannot be a
 * rewind (§Revalidation §5).
 *
 * SCORING roles, not admin-only: unlike a rewind this is part of officiating a
 * live match, and it is exactly as reversible as any other scoring action —
 * the cancellations are ordinary UNDO rows in the append-only log.
 */
export async function cancelFaultPointsAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, SCORING_ROLES);
  if (!authed.ok) return fail("You can't correct this match.");

  const fromSequence = intOrNull(fd, "fromSequence");
  if (fromSequence == null) return fail("Pick the moment the fault began.");
  const team = str(fd, "team");
  if (team !== "A" && team !== "B") return fail("Pick the team at fault.");

  // Same reasoning as the rewind below: signatures attest to a result, and
  // cancelling points underneath them would leave them attesting to a score
  // nobody signed.
  if (await resultLocked(matchId))
    return fail(
      "The scoresheet is signed. Reopen the match first — that invalidates the signatures.",
    );

  // Mandatory here (spec/29 Phase 3 guard rails): a correction that removes
  // points from the official record has to say why.
  const reason = str(fd, "reason").trim().slice(0, 200);
  if (reason.length < 3)
    return fail("Give a short reason — it is recorded on the scoresheet.");

  try {
    const { cancelled } = await cancelPointsForFault(matchId, {
      team,
      fromSequence,
      reason,
      actor: "SCORER",
      actorUserId: writerId(authed.auth),
      deviceInfo: writerNote(authed.auth),
    });
    await recordAudit({
      tenantId: authed.auth.tenantId,
      actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
      action: "match.fault_correction",
      entityType: "match",
      entityId: matchId,
      summary: `Cancelled ${cancelled} point(s) for team ${team} from event #${fromSequence} — ${reason}`,
      metadata: { team, fromSequence, cancelled, reason },
    });
    return ok(`Cancelled ${cancelled} point(s) scored by team ${team}.`);
  } catch (err) {
    if (err instanceof FaultCorrectionError) return fail(err.message);
    if (err instanceof MatchNotFoundError) return fail("Match not found.");
    if (err instanceof UnsupportedDisciplineError)
      return fail("This discipline can't be corrected this way.");
    throw err;
  }
}

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

  // Optional justification for the record (FIVB paper protocol expects a
  // remark for corrections) — stored on the REWIND event itself.
  const reason = str(fd, "reason").slice(0, 200) || null;

  try {
    const { state } = await rewindMatch(matchId, fromSequence, {
      actor: "SCORER",
      actorUserId: writerId(authed.auth),
      deviceInfo: writerNote(authed.auth),
      reason: reason ?? undefined,
    });
    await recordAudit({
      tenantId: authed.auth.tenantId,
      actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
      action: "match.rewind",
      entityType: "match",
      entityId: matchId,
      summary: `Rewound match to before event #${fromSequence}${reason ? ` — ${reason}` : ""}`,
      metadata: { fromSequence, resultingSequence: state.lastSequence, reason },
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
      confirmedBy: writerId(authed.auth),
      confirmedVia: "ADMIN",
    })
    .where(eq(matches.id, matchId));

  // Status transition → competition-scoped incremental backup (spec/23 §7.4).
  after(() =>
    scheduleIncrementalBackup(authed.auth.tenantId, row.competitionId),
  );

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
      .select({
        status: matches.status,
        via: matches.confirmedVia,
        competitionId: matches.competitionId,
      })
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

  // Status transition → competition-scoped incremental backup (spec/23 §7.4).
  after(() =>
    scheduleIncrementalBackup(authed.auth.tenantId, row.competitionId),
  );

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

/**
 * Assign the match officials printed in the scoresheet APPROVAL block
 * (spec/21). One form submits every role: a non-empty name upserts the row
 * (unique per match+role), a cleared name deletes it. Admin-only, like the
 * other result-adjacent actions; the 1st-referee sign-off (spec/20) remains
 * the other writer and wins by the same upsert.
 */
/** Slots that are table officials rather than referees (spec/24 A3). */
const SCORER_OFFICIAL_ROLES = new Set(["SCORER", "ASSISTANT_SCORER"]);

export async function saveMatchOfficials(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Only a competition admin can assign officials.");

  const roles = matchOfficials.role.enumValues;

  // Resolve each filled slot to a registry person BEFORE the transaction
  // (spec/24 §6.3): resolvePickedPerson may create a person, and doing that
  // inside the officials transaction would tie an unrelated insert to it. A slot
  // whose person can't be resolved keeps its typed name and stays unlinked
  // rather than failing the whole save.
  const personIds = new Map<string, string>();
  for (const role of roles) {
    const name = str(fd, `name_${role}`).slice(0, 120);
    if (!name) continue;
    const resolved = await resolvePickedPerson(
      authed.auth.tenantId,
      { personId: str(fd, `personId_${role}`), personName: name },
      SCORER_OFFICIAL_ROLES.has(role) ? "SCORER" : "REFEREE",
    );
    if (!("error" in resolved)) personIds.set(role, resolved.id);
  }

  let saved = 0;
  let removed = 0;
  await dbTx.transaction(async (tx) => {
    for (const role of roles) {
      const name = str(fd, `name_${role}`).slice(0, 120);
      const country = str(fd, `country_${role}`).slice(0, 40);
      const level = str(fd, `level_${role}`).slice(0, 40);
      if (!name) {
        const gone = await tx
          .delete(matchOfficials)
          .where(
            and(
              eq(matchOfficials.matchId, matchId),
              eq(matchOfficials.role, role),
            ),
          )
          .returning({ id: matchOfficials.id });
        removed += gone.length;
        continue;
      }
      await tx
        .insert(matchOfficials)
        .values({
          id: newId("official"),
          matchId,
          tenantId: authed.auth.tenantId,
          role,
          personId: personIds.get(role)!,
          name,
          country: country || null,
          level: level || null,
          source: "MANUAL",
          createdBy: writerId(authed.auth),
        })
        .onConflictDoUpdate({
          target: [matchOfficials.matchId, matchOfficials.role],
          set: {
            personId: personIds.get(role)!,
            name,
            country: country || null,
            level: level || null,
            source: "MANUAL",
            createdBy: writerId(authed.auth),
          },
        });
      saved += 1;
    }
  });

  await recordAudit({
    tenantId: authed.auth.tenantId,
    actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
    action: "match.officials",
    entityType: "match",
    entityId: matchId,
    summary: `Assigned match officials (${saved} set, ${removed} cleared)`,
  });

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  if (tenantSlug && competitionId) {
    revalidatePath(
      `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`,
    );
  }
  return ok("Officials saved.");
}

/**
 * Set the VIS match number (spec/22) — the join key the VSR live feed uses.
 * Clearing it disables dispatch for the match.
 */
export async function setMatchVisId(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const matchId = str(fd, "matchId");
  const authed = await authorizeMatch(matchId, ADMIN_ROLES);
  if (!authed.ok) return fail("Only a competition admin can set the VIS id.");

  const visId = str(fd, "visId").slice(0, 40);
  if (visId && !/^\d+$/.test(visId))
    return fail("The VIS match number must be numeric.");

  await db
    .update(matches)
    .set({ visId: visId || null })
    .where(eq(matches.id, matchId));

  await recordAudit({
    tenantId: authed.auth.tenantId,
    actor: { userId: authed.auth.user.id, email: authed.auth.user.email },
    action: "match.visId",
    entityType: "match",
    entityId: matchId,
    summary: visId ? `Set VIS match id ${visId}` : "Cleared the VIS match id",
  });

  const tenantSlug = str(fd, "tenantSlug");
  const competitionId = str(fd, "competitionId");
  if (tenantSlug && competitionId)
    revalidatePath(
      `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`,
    );
  return ok(visId ? "VIS match id saved." : "VIS match id cleared.");
}
