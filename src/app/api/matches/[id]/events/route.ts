// Match event endpoint.
//   POST → append a scoring/officiating event. Authorized to the match's tenant
//          (SCORER/admin), same-origin + rate-limited, and restricted to
//          client-submittable event types (spec/14 §A1/A2/A4/C2).
//
// Live state sync is via Supabase Realtime + GET /api/matches/[id]/state; the
// former SSE GET here was unused and was removed (spec/14 §C2).
//
// nodejs runtime: the engine talks to Postgres via postgres.js; force-dynamic
// because every response depends on the live event log.

import type { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events as eventsTable } from "@/db/schema";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import { sameOriginOk } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import {
  EventRejectedError,
  MatchNotFoundError,
  SequenceConflictError,
  UnsupportedDisciplineError,
  appendMatchEvent,
} from "@/lib/match-engine";

// Discipline-agnostic event payload: the engine for the match validates the
// concrete shape — this route only needs `type` to route it.
type EventPayload = { type: string } & Record<string, unknown>;

// Events a client may submit. The auto-emitted / system events (SET_END,
// MATCH_END, SIDE_SWITCH, TTO_START, SERVE_CLOCK_EXPIRE) are produced by the
// engine only — accepting them from a client would let it fabricate results
// (spec/14 §A2).
const CLIENT_SUBMITTABLE = new Set([
  "MATCH_CREATED", "COIN_TOSS", "MATCH_START", "SET_START", "LINEUP_CONFIRMED",
  "RALLY_WON_A", "RALLY_WON_B", "REPLAY_POINT", "TIMEOUT_REQUEST", "TIMEOUT_END",
  "TTO_END", "SUBSTITUTION", "LIBERO_REPLACEMENT", "LIBERO_REDESIGNATION",
  "VCS_CHALLENGE", "VCS_RESULT", "JUMP_SERVE_FOOT_FAULT", "ATTACK_ARC_FAULT",
  "DELAY_WARNING", "DELAY_PENALTY", "MEDICAL_TIMEOUT", "MEDICAL_TIMEOUT_END",
  "MISCONDUCT_WARNING", "MISCONDUCT_PENALTY", "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION", "NOTE", "UNDO",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → the match's event log for the scorer console's read-only log view.
// Authorized to the match's tenant (same roles as scoring); returns the
// denormalised display fields + payload so the client can render readable lines.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  const rows = await db
    .select({
      sequence: eventsTable.sequence,
      eventType: eventsTable.eventType,
      setNumber: eventsTable.setNumber,
      scoreAfterA: eventsTable.scoreAfterA,
      scoreAfterB: eventsTable.scoreAfterB,
      serverTeam: eventsTable.serverTeam,
      timestamp: eventsTable.timestamp,
      actor: eventsTable.actor,
      notes: eventsTable.notes,
      payload: eventsTable.payload,
    })
    .from(eventsTable)
    .where(eq(eventsTable.matchId, id))
    .orderBy(asc(eventsTable.sequence));

  return Response.json({ events: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!sameOriginOk(req))
    return Response.json({ error: "Bad origin" }, { status: 403 });

  // Authorization is keyed to the *match's* tenant, not the URL or the caller's
  // primary tenant (spec/14 §A1).
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  if (!(await rateLimit(`events:${authed.auth.user.id}:${id}`)))
    return Response.json({ error: "Too many requests" }, { status: 429 });

  let body: { payload?: EventPayload };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.payload?.type) {
    return Response.json({ error: "Missing event payload" }, { status: 400 });
  }
  if (!CLIENT_SUBMITTABLE.has(body.payload.type)) {
    return Response.json(
      { error: "Event type not accepted from client" },
      { status: 422 },
    );
  }

  try {
    const { state, newEvents } = await appendMatchEvent(id, body.payload, {
      actor: "SCORER",
    });
    return Response.json({
      state,
      events: newEvents,
      autoEmitted: newEvents.slice(1).map((e) => e.payload),
    });
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof UnsupportedDisciplineError)
      return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof EventRejectedError)
      return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof SequenceConflictError)
      return Response.json(
        { error: "Concurrent write — please retry" },
        { status: 409 },
      );
    throw err;
  }
}
