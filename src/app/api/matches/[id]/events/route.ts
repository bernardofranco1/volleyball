// Match event endpoint.
//   POST  → append a scoring/officiating event (scorer only)
//   GET   → Server-Sent Events stream of state updates (resync fallback;
//           Supabase Realtime is the low-latency primary channel)
//
// nodejs runtime: the engine talks to Postgres via postgres.js; force-dynamic
// because every response depends on the live event log.

import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  EventRejectedError,
  MatchNotFoundError,
  SequenceConflictError,
  UnsupportedDisciplineError,
  appendMatchEvent,
  loadMatchStateFresh,
} from "@/lib/match-engine";

// Discipline-agnostic event payload: the engine for the match (beach/indoor)
// validates the concrete shape — this route only needs `type` to route it.
type EventPayload = { type: string } & Record<string, unknown>;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { payload?: EventPayload };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.payload?.type) {
    return Response.json({ error: "Missing event payload" }, { status: 400 });
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

// SSE: emit the current state, then poll the log and push on every change.
// Bounded lifetime — clients (EventSource) auto-reconnect.
const POLL_MS = 1500;
const MAX_TICKS = 40; // ~60s, then the client reconnects

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);

      let lastSeq = -1;
      try {
        for (let tick = 0; tick < MAX_TICKS && !closed; tick++) {
          const { state } = await loadMatchStateFresh(id);
          if (state.lastSequence !== lastSeq) {
            lastSeq = state.lastSequence;
            send("match-update", { state });
          } else {
            send("ping", { t: tick });
          }
          if (state.status === "FINISHED") break;
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "stream error",
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
