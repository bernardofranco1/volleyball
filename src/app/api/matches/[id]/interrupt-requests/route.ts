// Interrupt requests (team tablet → scorer): timeout / substitution / challenge
// / medical. Tablets create + poll via session token; the scorer resolves via a
// Supabase-authenticated PATCH. Approving a timeout emits the real event so the
// clock starts; other approvals just clear the request for the scorer to action.
import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { interruptRequests } from "@/db/schema";
import {
  authorizeMatch,
  SCORING_ROLES,
  writerId,
  writerNote,
} from "@/lib/authz";
import { sameOriginOk } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { validateTabletToken } from "@/lib/match-session";
import { appendMatchEvent, loadMatchState } from "@/lib/match-engine";
import { timeoutCapForSet } from "@/engine/config";
import { broadcastInterruptRequest } from "@/lib/realtime";
import { newId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PROTEST (spec/29 F12): the team lodges an in-match protest from its tablet;
// the scorer's approval records the PROTEST_LODGED marker. Unquota-ed — the
// protest protocol, not this endpoint, decides whether it stands.
const TYPES = [
  "TIMEOUT",
  "SUBSTITUTION",
  "CHALLENGE",
  "MEDICAL",
  "PROTEST",
] as const;
type ReqType = (typeof TYPES)[number];

// The current-set fields the quota backstop reads (indoor set state; tablets are
// indoor-only, and the fields are optional so other disciplines are tolerated).
type QuotaSet = {
  setNumber: number;
  timeoutsUsedA?: number;
  timeoutsUsedB?: number;
  subsUsedA?: number;
  subsUsedB?: number;
  vcs?: { challengesRemainingA?: number; challengesRemainingB?: number };
};

/**
 * Remaining allowance for a request type on the active set, or null when it
 * can't be determined (⇒ let the scorer's approval + engine validation decide).
 * Only quota-limited types return a number.
 */
async function remainingFor(
  matchId: string,
  team: "A" | "B",
  type: ReqType,
): Promise<number | null> {
  if (type === "MEDICAL" || type === "PROTEST") return null;
  try {
    const { state, config } = await loadMatchState(matchId);
    const s = state as unknown as {
      currentSetNumber: number;
      sets: QuotaSet[];
    };
    const set = s.sets[s.currentSetNumber - 1];
    if (!set) return null;
    if (type === "TIMEOUT") {
      const used = team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB;
      return timeoutCapForSet(config, set.setNumber) - (used ?? 0);
    }
    if (type === "SUBSTITUTION") {
      const used = team === "A" ? set.subsUsedA : set.subsUsedB;
      return config.maxSubsPerSet - (used ?? 0);
    }
    // CHALLENGE
    if (!config.vcsEnabled) return 0;
    const rem =
      team === "A" ? set.vcs?.challengesRemainingA : set.vcs?.challengesRemainingB;
    return rem ?? 0;
  } catch {
    return null; // state unavailable — don't block; approval re-validates
  }
}

// ── tablet: create a request ──────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!sameOriginOk(req))
    return Response.json({ error: "Bad origin" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    team?: "A" | "B";
    requestType?: ReqType;
    note?: string;
    outPlayerId?: string;
    inPlayerId?: string;
    isExceptional?: boolean;
  } | null;
  if (!body || (body.team !== "A" && body.team !== "B"))
    return Response.json({ error: "Bad request" }, { status: 400 });
  if (!body.requestType || !TYPES.includes(body.requestType))
    return Response.json({ error: "Unknown request type" }, { status: 400 });

  const session = await validateTabletToken(body.token, id, body.team);
  if (!session)
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  if (!(await rateLimit(`interrupt:${session.id}`)))
    return Response.json({ error: "Too many requests" }, { status: 429 });

  // A substitution must name both players (validated for real on approval).
  if (body.requestType === "SUBSTITUTION") {
    const ok =
      typeof body.outPlayerId === "string" &&
      body.outPlayerId.length > 0 &&
      body.outPlayerId.length <= 64 &&
      typeof body.inPlayerId === "string" &&
      body.inPlayerId.length > 0 &&
      body.inPlayerId.length <= 64;
    if (!ok)
      return Response.json(
        { error: "Substitution needs both players" },
        { status: 400 },
      );
  }

  // Quota backstop: a stale tablet must not be able to queue a request the team
  // has no allowance for (the buttons grey out client-side, but don't trust it).
  //
  // An EXCEPTIONAL substitution (Rule 15.7, spec/29 F9) is the one thing this
  // must let through at zero: it exists precisely because the legal
  // substitutions are gone, so "no allowance remaining" is its precondition,
  // not its disqualification. Refusing it here made the tablet flow dead on
  // arrival — spec/29 fixed the approval path, which the request never reached
  // (spec/30 R2). The engine validator remains the real gate: it accepts the
  // flag past the per-set cap and still rejects an illegal player choice.
  const exceptionalSub =
    body.requestType === "SUBSTITUTION" && body.isExceptional === true;
  const remaining = await remainingFor(id, body.team, body.requestType);
  if (!exceptionalSub && remaining != null && remaining <= 0)
    return Response.json(
      { error: "No allowance remaining for this request" },
      { status: 409 },
    );

  const payload =
    body.requestType === "SUBSTITUTION"
      ? {
          outPlayerId: body.outPlayerId,
          inPlayerId: body.inPlayerId,
          // Rule 15.7 (spec/29 F9) — the scorer approves what was asked for.
          // Coerced, never trusted raw: this comes off a tablet.
          isExceptional: body.isExceptional === true,
        }
      : body.note
        ? { note: String(body.note).slice(0, 280) } // untrusted tablet note
        : null;

  const requestId = newId("ireq");
  await db.insert(interruptRequests).values({
    id: requestId,
    matchId: id,
    tenantId: session.tenantId,
    team: body.team,
    requestType: body.requestType,
    payload,
    status: "PENDING",
  });
  await broadcastInterruptRequest(id, {
    requestId,
    team: body.team,
    requestType: body.requestType,
  });
  return Response.json({ requestId, status: "PENDING" });
}

// ── tablet: poll its own requests ─────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token");
  const team = req.nextUrl.searchParams.get("team");

  // Scorer fallback (brief §2.2): no token ⇒ an authenticated scorer/admin of the
  // match polling for PENDING requests (both teams). Realtime broadcasts are
  // fire-and-forget with no replay, so this poll guarantees a request still
  // surfaces if the scorer's socket missed the broadcast.
  if (!token) {
    const authed = await authorizeMatch(id, SCORING_ROLES);
    if (!authed.ok)
      return Response.json({ error: "Forbidden" }, { status: authed.status });
    const pendingRows = await db
      .select({
        id: interruptRequests.id,
        team: interruptRequests.team,
        requestType: interruptRequests.requestType,
        payload: interruptRequests.payload,
        createdAt: interruptRequests.createdAt,
      })
      .from(interruptRequests)
      .where(
        and(
          eq(interruptRequests.matchId, id),
          eq(interruptRequests.status, "PENDING"),
        ),
      )
      .orderBy(desc(interruptRequests.createdAt))
      .limit(20);
    return Response.json({ requests: pendingRows });
  }

  if (team !== "A" && team !== "B")
    return Response.json({ error: "Bad request" }, { status: 400 });
  const session = await validateTabletToken(token, id, team);
  if (!session)
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });

  const rows = await db
    .select({
      id: interruptRequests.id,
      requestType: interruptRequests.requestType,
      status: interruptRequests.status,
      createdAt: interruptRequests.createdAt,
    })
    .from(interruptRequests)
    .where(
      and(
        eq(interruptRequests.matchId, id),
        eq(interruptRequests.team, team),
      ),
    )
    .orderBy(desc(interruptRequests.createdAt))
    .limit(10);
  return Response.json({ requests: rows });
}

// ── scorer: approve / deny ────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!sameOriginOk(req))
    return Response.json({ error: "Bad origin" }, { status: 403 });

  // Only a scorer/admin of the match's tenant may resolve requests (spec/14 §A1).
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  const body = (await req.json().catch(() => null)) as {
    requestId?: string;
    status?: "APPROVED" | "DENIED";
  } | null;
  if (!body?.requestId || (body.status !== "APPROVED" && body.status !== "DENIED"))
    return Response.json({ error: "Bad request" }, { status: 400 });

  const rows = await db
    .select()
    .from(interruptRequests)
    .where(
      and(
        eq(interruptRequests.id, body.requestId),
        eq(interruptRequests.matchId, id),
      ),
    )
    .limit(1);
  const reqRow = rows[0];
  if (!reqRow)
    return Response.json({ error: "Request not found" }, { status: 404 });

  await db
    .update(interruptRequests)
    .set({ status: body.status, resolvedAt: new Date(), resolvedBy: writerId(authed.auth) })
    .where(eq(interruptRequests.id, body.requestId));

  // Approving a request applies the real engine event immediately. TIMEOUT starts
  // the clock; SUBSTITUTION carries the tablet-chosen players; CHALLENGE opens a
  // video review. MEDICAL still needs manual scorer handling. Engine validation
  // is the final gate — an invalid event (phase/legality/quota) is swallowed so
  // the scorer can resolve it manually.
  if (body.status === "APPROVED") {
    const pl = (reqRow.payload ?? {}) as {
      outPlayerId?: string;
      inPlayerId?: string;
      isExceptional?: boolean;
    };
    const event =
      reqRow.requestType === "TIMEOUT"
        ? { type: "TIMEOUT_REQUEST", team: reqRow.team }
        : reqRow.requestType === "CHALLENGE"
          ? { type: "VCS_CHALLENGE", team: reqRow.team }
          : reqRow.requestType === "SUBSTITUTION" && pl.outPlayerId && pl.inPlayerId
            ? {
                type: "SUBSTITUTION",
                team: reqRow.team,
                outPlayerId: pl.outPlayerId,
                inPlayerId: pl.inPlayerId,
                // What the TEAM asked for (spec/29 F9). Hardcoding false here
                // turned an exceptional substitution into an ordinary one,
                // which the engine then rejected as over the per-set limit —
                // exactly when a team most needs it.
                isExceptional: pl.isExceptional === true,
              }
            : null;
    if (event) {
      try {
        await appendMatchEvent(id, event, {
          actor: "SCORER",
          deviceInfo: writerNote(authed.auth),
        });
      } catch {
        // Invalid (phase/legality/quota) — scorer handles manually.
      }
    }
  }

  return Response.json({ ok: true });
}
