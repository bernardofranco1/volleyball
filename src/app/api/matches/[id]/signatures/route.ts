// Scoresheet signatures (spec/20) — the APPROVAL block of the official sheet.
//   GET    → signatures on record + who is still missing + the digest to sign
//   POST   → record one signature (captain or 1st referee) on the scorer device
//   DELETE → clear one signature before the set is complete (a re-do)
//
// Everyone signs on the SCORER device, so authorization is the scorer's own:
// match-scoped role + the per-match PIN, exactly like posting an event. The
// signature therefore records both the signer's name and `capturedBy` (the
// authenticated session that collected it) — an attestation taken by the
// scorer, not an independently authenticated signer.
//
// The last signature also confirms the result: PENDING_CONFIRMATION → FINISHED
// with confirmedVia = SIGNATURES, in one transaction with the insert.

import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  competitions,
  matchOfficials,
  matchSignatures,
  matches,
  players,
  tenants,
} from "@/db/schema";
import { ADMIN_ROLES, authorizeMatch, hasRole, SCORING_ROLES } from "@/lib/authz";
import { sameOriginOk } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { scorerPinSatisfied } from "@/lib/scorer-pin";
import { loadMatchState, MatchNotFoundError } from "@/lib/match-engine";
import {
  isBenchRole,
  isConfirmationRole,
  isPrematchRole,
  isSignatureIntent,
  isSignatureRole,
  loadOfficials,
  loadSignatures,
  parseStrokes,
  resultDigest,
  signatureProgress,
  signatureRoleLabel,
  type SignatureRole,
  type SignatureStrokes,
} from "@/lib/match-signatures";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 120;
const MAX_REMARKS = 500;

/** Postgres unique-violation (23505), however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  return code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505";
}

/** Match row + config bits the signing rules need. */
async function loadTarget(matchId: string) {
  const row = (
    await db
      .select({
        tenantId: matches.tenantId,
        competitionId: matches.competitionId,
        status: matches.status,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        tenantSlug: tenants.slug,
      })
      .from(matches)
      .innerJoin(competitions, eq(competitions.id, matches.competitionId))
      .innerJoin(tenants, eq(tenants.id, matches.tenantId))
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  return row ?? null;
}

async function progressFor(matchId: string) {
  const [{ state, config }, signatures, officials] = await Promise.all([
    loadMatchState(matchId),
    loadSignatures(matchId),
    loadOfficials(matchId),
  ]);
  const digest = state.status === "FINISHED" ? resultDigest(state) : null;
  return {
    state,
    config,
    signatures,
    officials,
    digest,
    ...signatureProgress(signatures, digest),
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  try {
    const p = await progressFor(id);
    return Response.json({
      policy: p.config.resultSignatures,
      digest: p.digest,
      sequence: p.state.lastSequence,
      complete: p.complete,
      missing: p.missing,
      stale: p.stale,
      officials: p.officials,
      signatures: p.signatures.map((s) => ({
        role: s.role,
        signerName: s.signerName,
        signerPlayerId: s.signerPlayerId,
        intent: s.intent,
        remarks: s.remarks,
        signedAt: s.signedAt,
        hasStrokes: s.strokes != null,
      })),
    });
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: "Match not found" }, { status: 404 });
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!sameOriginOk(req))
    return Response.json({ error: "Bad origin" }, { status: 403 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const [authed, allowed, body] = await Promise.all([
    authorizeMatch(id, SCORING_ROLES),
    rateLimit(`signatures:${ip}:${id}`),
    req.json().catch(() => null) as Promise<Record<string, unknown> | null>,
  ]);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });
  // Same gate as scoring: a tenant SCORER must have satisfied this match's PIN.
  if (
    !hasRole(authed.auth.roles, ADMIN_ROLES) &&
    !(await scorerPinSatisfied(id))
  )
    return Response.json({ error: "Scorer PIN required" }, { status: 403 });
  if (!allowed) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const role = body.role;
  if (!isSignatureRole(role))
    return Response.json({ error: "Unknown signature role" }, { status: 422 });
  const intent = body.intent ?? "ACCEPT";
  if (!isSignatureIntent(intent))
    return Response.json({ error: "Unknown signature intent" }, { status: 422 });

  const signerName = String(body.signerName ?? "").trim().slice(0, MAX_NAME);
  if (signerName.length < 2)
    return Response.json(
      { error: `A name is required for the ${signatureRoleLabel(role)}.` },
      { status: 422 },
    );
  const remarksRaw = String(body.remarks ?? "").trim().slice(0, MAX_REMARKS);
  // A protest or a refusal is a statement of record — it must say why.
  if (intent !== "ACCEPT" && remarksRaw.length < 3)
    return Response.json(
      { error: "Add a short reason for the protest or refusal." },
      { status: 422 },
    );

  // REFUSED carries no drawing; ACCEPT and PROTEST must.
  let strokes: SignatureStrokes | null = null;
  if (intent !== "REFUSED") {
    const parsed = parseStrokes(body.strokes);
    if (!parsed.ok)
      return Response.json({ error: parsed.reason }, { status: 422 });
    strokes = parsed.value;
  }

  const row = await loadTarget(id);
  if (!row) return Response.json({ error: "Match not found" }, { status: 404 });

  let p: Awaited<ReturnType<typeof progressFor>>;
  try {
    p = await progressFor(id);
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: "Match not found" }, { status: 404 });
    throw err;
  }

  if (p.config.resultSignatures === "OFF")
    return Response.json(
      { error: "This competition does not use scoresheet signatures." },
      { status: 409 },
    );

  const prematch = isPrematchRole(role);
  const bench = isBenchRole(role);
  if (prematch) {
    // Pre-match signatures (spec/21 Phase D) attest to the roster/lineup
    // before play — once the result is in they can no longer be added.
    if (p.state.status === "FINISHED" || row.status === "FINISHED")
      return Response.json(
        { error: "The match is over — pre-match signatures are closed." },
        { status: 409 },
      );
    if (intent !== "ACCEPT")
      return Response.json(
        { error: "A pre-match signature cannot protest or refuse." },
        { status: 422 },
      );
  } else {
    if (p.state.status !== "FINISHED" || p.digest == null)
      return Response.json(
        { error: "The match is not over yet." },
        { status: 409 },
      );
    // Bench signatures (scorer / assistant scorer) may still be added after
    // the trio confirmed the result — they complete the APPROVAL block, they
    // don't change what was confirmed.
    if (!bench && row.status === "FINISHED" && p.complete)
      return Response.json(
        { error: "This result is already signed and confirmed." },
        { status: 409 },
      );

    // The signature attests to ONE state of the log. If the score moved since
    // the client loaded the session, refuse — the console restarts the round.
    const expected = String(body.expectedDigest ?? "");
    if (expected && expected !== p.digest)
      return Response.json(
        {
          error: "The result changed since you opened the signature panel.",
          digest: p.digest,
        },
        { status: 409 },
      );
  }
  // Pre-match signatures store a digest of the state they were taken at; it is
  // never compared for staleness (scoring afterwards is the whole point).
  const digestToStore = prematch ? resultDigest(p.state) : p.digest!;

  // Captains sign as a named player of their own team; the referee and the
  // scorer bench type a name.
  let signerPlayerId: string | null = null;
  if (role !== "FIRST_REFEREE" && !bench) {
    const wanted = body.signerPlayerId;
    if (typeof wanted === "string" && wanted) {
      const teamId = role.startsWith("TEAM_A") ? row.teamAId : row.teamBId;
      const player = (
        await db
          .select({ id: players.id })
          .from(players)
          .where(and(eq(players.id, wanted), eq(players.teamId, teamId)))
          .limit(1)
      )[0];
      if (!player)
        return Response.json(
          { error: "That player is not on this team." },
          { status: 422 },
        );
      signerPlayerId = player.id;
    }
  }

  const now = new Date();
  const capturedBy = authed.auth.user.id;
  // Does this signature complete the confirmation trio? Pre-match and bench
  // signatures never confirm the result. (The one being written counts.)
  const remaining = p.missing.filter((r) => r !== role);
  const completesResult = isConfirmationRole(role) && remaining.length === 0;

  try {
    await db.transaction(async (tx) => {
    // Supersede any live signature for this role (kept for the record).
    await tx
      .update(matchSignatures)
      .set({
        invalidatedAt: now,
        invalidatedReason:
          isConfirmationRole(role) && p.stale.includes(role as SignatureRole)
            ? "Result changed after signing"
            : "Replaced by a new signature",
      })
      .where(
        and(
          eq(matchSignatures.matchId, id),
          eq(matchSignatures.role, role),
          isNull(matchSignatures.invalidatedAt),
        ),
      );

    await tx.insert(matchSignatures).values({
      id: newId("sig"),
      matchId: id,
      tenantId: row.tenantId,
      role,
      signerName,
      signerPlayerId,
      strokes,
      intent,
      remarks: remarksRaw || null,
      signedAt: now,
      signedSequence: p.state.lastSequence,
      resultDigest: digestToStore,
      capturedBy,
      deviceInfo: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    });

    // An official's name is scoresheet data in its own right: keep it on the
    // officials row so the report prints it and the (later) match-data import
    // has the same place to write. Applies to the 1st referee and the scorer
    // bench (their signature-role names match the officials-role enum).
    if (role === "FIRST_REFEREE" || bench) {
      await tx
        .insert(matchOfficials)
        .values({
          id: newId("off"),
          matchId: id,
          tenantId: row.tenantId,
          role: role as "FIRST_REFEREE" | "SCORER" | "ASSISTANT_SCORER",
          name: signerName,
          source: "MANUAL",
          createdBy: capturedBy,
        })
        .onConflictDoUpdate({
          target: [matchOfficials.matchId, matchOfficials.role],
          set: { name: signerName },
        });
    }

    if (completesResult) {
      await tx
        .update(matches)
        .set({
          status: "FINISHED",
          finishedAt: now,
          confirmedAt: now,
          confirmedBy: capturedBy,
          confirmedVia: "SIGNATURES",
        })
        .where(eq(matches.id, id));
    }
    });
  } catch (err) {
    // The partial unique index (one live signature per role) is the backstop
    // for two devices signing the same role at once — the loser reloads rather
    // than seeing a 500.
    if (isUniqueViolation(err))
      return Response.json(
        { error: "That signature was just recorded on another device. Reload." },
        { status: 409 },
      );
    throw err;
  }

  await recordAudit({
    tenantId: row.tenantId,
    actor: { userId: capturedBy, email: authed.auth.user.email },
    action: completesResult ? "match.signOff.complete" : "match.signOff",
    entityType: "match",
    entityId: id,
    summary: completesResult
      ? `Scoresheet signed by all three — result confirmed`
      : `${signatureRoleLabel(role)} signed the scoresheet`,
    metadata: { role, intent, signerName, digest: p.digest, complete: completesResult },
  });

  if (completesResult) {
    // Standings, brackets, the match centre and the public board all key off
    // FINISHED — refresh the same surfaces the manager confirmation does.
    const base = `/t/${row.tenantSlug}/competitions/${row.competitionId}`;
    revalidatePath(`${base}/matches/${id}`);
    revalidatePath(`${base}/standings`);
    revalidatePath(`/t/${row.tenantSlug}/matches`);
    revalidatePath(`/t/${row.tenantSlug}/scoreboard/${id}`);
  }

  const after = await progressFor(id);
  return Response.json({
    ok: true,
    complete: after.complete,
    missing: after.missing,
    confirmed: completesResult,
    digest: after.digest,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!sameOriginOk(req))
    return Response.json({ error: "Bad origin" }, { status: 403 });

  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });
  if (
    !hasRole(authed.auth.roles, ADMIN_ROLES) &&
    !(await scorerPinSatisfied(id))
  )
    return Response.json({ error: "Scorer PIN required" }, { status: 403 });

  const role = new URL(req.url).searchParams.get("role");
  if (!isSignatureRole(role))
    return Response.json({ error: "Unknown signature role" }, { status: 422 });

  const row = await loadTarget(id);
  if (!row) return Response.json({ error: "Match not found" }, { status: 404 });
  // Once the result is confirmed, a signature can only be removed by reopening
  // the match (which invalidates all three, with a reason, and is audited).
  if (row.status === "FINISHED")
    return Response.json(
      { error: "The result is confirmed — reopen the match to change it." },
      { status: 409 },
    );

  const now = new Date();
  await db
    .update(matchSignatures)
    .set({ invalidatedAt: now, invalidatedReason: "Cleared on the scorer device" })
    .where(
      and(
        eq(matchSignatures.matchId, id),
        eq(matchSignatures.role, role),
        isNull(matchSignatures.invalidatedAt),
      ),
    );

  const after = await progressFor(id);
  return Response.json({ ok: true, missing: after.missing, complete: after.complete });
}
