/**
 * Result approval — scoresheet signatures (spec/20).
 *
 * After the last rally a match parks at PENDING_CONFIRMATION. On beach and
 * indoor the FIVB scoresheet carries an APPROVAL block: both team captains and
 * the 1st referee sign it. This module owns the rules around those signatures:
 * what exactly was signed (`resultDigest`), what a valid signature payload
 * looks like, and when the set of signatures is complete.
 *
 * Two invariants drive the design:
 *
 * 1. A signature attests to ONE state of the event log. The digest folds the
 *    per-set scores, the sets won, the winner and the event sequence into a
 *    hash; if a later undo/rewind changes any of it, the stored digest no
 *    longer matches and the signatures are invalidated rather than silently
 *    re-attributed to a score nobody signed.
 * 2. Signatures are part of the official document and are kept FOREVER. A
 *    superseded signature is marked `invalidatedAt` — never deleted.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { matchSignatures, matchOfficials, matches } from "@/db/schema";

export const SIGNATURE_ROLES = [
  "TEAM_A_CAPTAIN",
  "TEAM_B_CAPTAIN",
  "FIRST_REFEREE",
] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

export const SIGNATURE_INTENTS = ["ACCEPT", "PROTEST", "REFUSED"] as const;
export type SignatureIntent = (typeof SIGNATURE_INTENTS)[number];

/** Vector strokes normalised to the pad box (all coordinates 0..1). */
export interface SignatureStrokes {
  pad: { w: number; h: number };
  strokes: number[][][];
}

/** Payload limits — a signature is a few hundred points, not a drawing. */
export const STROKE_LIMITS = {
  maxStrokes: 200,
  maxPointsPerStroke: 2000,
  maxTotalPoints: 4000,
} as const;

export function isSignatureRole(v: unknown): v is SignatureRole {
  return typeof v === "string" && (SIGNATURE_ROLES as readonly string[]).includes(v);
}

export function isSignatureIntent(v: unknown): v is SignatureIntent {
  return (
    typeof v === "string" && (SIGNATURE_INTENTS as readonly string[]).includes(v)
  );
}

/**
 * Validate and normalise a strokes payload from the client. Returns the value
 * to store, or a reason string. Coordinates are clamped to the pad box and
 * rounded to 4 decimals — enough for a signature, and it keeps the row small.
 */
export function parseStrokes(
  input: unknown,
): { ok: true; value: SignatureStrokes } | { ok: false; reason: string } {
  if (input == null || typeof input !== "object")
    return { ok: false, reason: "Signature is missing." };
  const raw = input as Partial<SignatureStrokes>;
  const w = raw.pad?.w;
  const h = raw.pad?.h;
  if (!Number.isFinite(w) || !Number.isFinite(h) || !w || !h)
    return { ok: false, reason: "Signature pad size is missing." };
  if (!Array.isArray(raw.strokes) || raw.strokes.length === 0)
    return { ok: false, reason: "Signature is empty." };
  if (raw.strokes.length > STROKE_LIMITS.maxStrokes)
    return { ok: false, reason: "Signature has too many strokes." };

  let total = 0;
  const strokes: number[][][] = [];
  for (const stroke of raw.strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0) continue;
    if (stroke.length > STROKE_LIMITS.maxPointsPerStroke)
      return { ok: false, reason: "Signature stroke is too long." };
    const pts: number[][] = [];
    for (const p of stroke) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [x, y] = p;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([round4(clamp01(x as number)), round4(clamp01(y as number))]);
    }
    if (pts.length === 0) continue;
    total += pts.length;
    if (total > STROKE_LIMITS.maxTotalPoints)
      return { ok: false, reason: "Signature is too detailed." };
    strokes.push(pts);
  }
  if (strokes.length === 0) return { ok: false, reason: "Signature is empty." };
  return {
    ok: true,
    value: { pad: { w: round4(w as number), h: round4(h as number) }, strokes },
  };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** The slice of any engine state a signature attests to (all four match it). */
export interface SignableState {
  matchId: string;
  status: string;
  winner: "A" | "B" | null;
  setsWonA: number;
  setsWonB: number;
  lastSequence: number;
  sets: { scoreA: number; scoreB: number; winner: "A" | "B" | null }[];
}

/**
 * The canonical description of the result being signed. Deliberately built
 * from the replayed engine state (not the derived match columns), so it covers
 * exactly what the console showed the signers.
 */
export function resultFingerprint(state: SignableState): string {
  const sets = state.sets
    .map((s) => `${s.scoreA}-${s.scoreB}:${s.winner ?? "-"}`)
    .join("|");
  return [
    `m:${state.matchId}`,
    `st:${state.status}`,
    `w:${state.winner ?? "-"}`,
    `sw:${state.setsWonA}-${state.setsWonB}`,
    `seq:${state.lastSequence}`,
    `sets:${sets}`,
  ].join(";");
}

/** SHA-256 of the fingerprint — stored on every signature row. */
export function resultDigest(state: SignableState): string {
  return createHash("sha256").update(resultFingerprint(state)).digest("hex");
}

export interface SignatureRecord {
  id: string;
  role: SignatureRole;
  signerName: string;
  signerPlayerId: string | null;
  strokes: SignatureStrokes | null;
  intent: SignatureIntent;
  remarks: string | null;
  signedAt: Date;
  signedSequence: number;
  resultDigest: string;
  capturedBy: string | null;
}

export interface OfficialRecord {
  role: string;
  name: string;
  country: string | null;
  level: string | null;
  source: string;
}

/** Live (non-invalidated) signatures for a match, in signing order. */
export async function loadSignatures(matchId: string): Promise<SignatureRecord[]> {
  const rows = await db
    .select({
      id: matchSignatures.id,
      role: matchSignatures.role,
      signerName: matchSignatures.signerName,
      signerPlayerId: matchSignatures.signerPlayerId,
      strokes: matchSignatures.strokes,
      intent: matchSignatures.intent,
      remarks: matchSignatures.remarks,
      signedAt: matchSignatures.signedAt,
      signedSequence: matchSignatures.signedSequence,
      resultDigest: matchSignatures.resultDigest,
      capturedBy: matchSignatures.capturedBy,
    })
    .from(matchSignatures)
    .where(
      and(
        eq(matchSignatures.matchId, matchId),
        isNull(matchSignatures.invalidatedAt),
      ),
    )
    .orderBy(asc(matchSignatures.signedAt));
  return rows as SignatureRecord[];
}

/** Officials recorded for a match (name-only today: the 1st referee). */
export async function loadOfficials(matchId: string): Promise<OfficialRecord[]> {
  return (await db
    .select({
      role: matchOfficials.role,
      name: matchOfficials.name,
      country: matchOfficials.country,
      level: matchOfficials.level,
      source: matchOfficials.source,
    })
    .from(matchOfficials)
    .where(eq(matchOfficials.matchId, matchId))) as OfficialRecord[];
}

/**
 * Which roles are still missing, and whether every signature on record attests
 * to `digest`. A stale signature (someone undid a point after signing) counts
 * as missing so the console asks for it again.
 */
export function signatureProgress(
  signatures: SignatureRecord[],
  digest: string | null,
): { missing: SignatureRole[]; stale: SignatureRole[]; complete: boolean } {
  const missing: SignatureRole[] = [];
  const stale: SignatureRole[] = [];
  for (const role of SIGNATURE_ROLES) {
    const sig = signatures.find((s) => s.role === role);
    if (!sig) {
      missing.push(role);
      continue;
    }
    if (digest != null && sig.resultDigest !== digest) {
      stale.push(role);
      missing.push(role);
    }
  }
  return { missing, stale, complete: missing.length === 0 };
}

/** Human label for a signature role (English; the UI uses i18n keys). */
export function signatureRoleLabel(role: SignatureRole): string {
  switch (role) {
    case "TEAM_A_CAPTAIN":
      return "Team A captain";
    case "TEAM_B_CAPTAIN":
      return "Team B captain";
    case "FIRST_REFEREE":
      return "First referee";
  }
}

/**
 * Is the match locked against further scoring? A signed scoresheet is a legal
 * document: once all three signatures are in and the result is confirmed, no
 * event (not even an undo) may be appended. Getting back in means reopening the
 * match, which invalidates the signatures with a recorded reason.
 *
 * A manager-confirmed result (confirmedVia ADMIN, no signatures) is NOT locked
 * — that path predates signing and stays as it was.
 */
export async function resultLocked(matchId: string): Promise<boolean> {
  const row = (
    await db
      .select({ status: matches.status, via: matches.confirmedVia })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  return row?.status === "FINISHED" && row?.via === "SIGNATURES";
}

/**
 * Invalidate every live signature for a match (kept for the record) — used when
 * an admin reopens a signed result. Returns how many were superseded.
 */
export async function invalidateSignatures(
  matchId: string,
  reason: string,
): Promise<number> {
  const rows = await db
    .update(matchSignatures)
    .set({ invalidatedAt: new Date(), invalidatedReason: reason })
    .where(
      and(
        eq(matchSignatures.matchId, matchId),
        isNull(matchSignatures.invalidatedAt),
      ),
    )
    .returning({ id: matchSignatures.id });
  return rows.length;
}
