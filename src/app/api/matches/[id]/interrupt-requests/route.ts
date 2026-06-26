// Interrupt requests (team tablet → scorer): timeout / substitution / challenge
// / medical. Tablets create + poll via session token; the scorer resolves via a
// Supabase-authenticated PATCH. Approving a timeout emits the real event so the
// clock starts; other approvals just clear the request for the scorer to action.
import type { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { interruptRequests } from "@/db/schema";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import { sameOriginOk } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { validateTabletToken } from "@/lib/match-session";
import { appendMatchEvent } from "@/lib/match-engine";
import { broadcastInterruptRequest } from "@/lib/realtime";
import { newId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["TIMEOUT", "SUBSTITUTION", "CHALLENGE", "MEDICAL"] as const;
type ReqType = (typeof TYPES)[number];

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

  const requestId = newId("ireq");
  await db.insert(interruptRequests).values({
    id: requestId,
    matchId: id,
    tenantId: session.tenantId,
    team: body.team,
    requestType: body.requestType,
    payload: body.note ? { note: body.note } : null,
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
    .set({ status: body.status, resolvedAt: new Date(), resolvedBy: authed.auth.user.id })
    .where(eq(interruptRequests.id, body.requestId));

  // Approving a timeout applies it immediately so the clock starts. Subs and
  // challenges need scorer-entered detail, so they're left to the action bar.
  if (body.status === "APPROVED" && reqRow.requestType === "TIMEOUT") {
    try {
      await appendMatchEvent(
        id,
        { type: "TIMEOUT_REQUEST", team: reqRow.team },
        { actor: "SCORER" },
      );
    } catch {
      // Invalid phase (e.g. not between rallies) — scorer handles manually.
    }
  }

  return Response.json({ ok: true });
}
