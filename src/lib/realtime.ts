// Server-side Supabase Realtime broadcast helpers.
//
// Uses the Realtime HTTP broadcast endpoint (no websocket needed server-side,
// which suits serverless route handlers). Authenticated with the service/secret
// key. Broadcast failures are swallowed — the SSE stream and client resync are
// the fallback, so a realtime hiccup must never fail a scoring request.

import { captureError } from "@/lib/observability";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type BroadcastMessage = {
  topic: string;
  event: string;
  payload: unknown;
};

async function broadcast(messages: BroadcastMessage[]): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    });
  } catch (err) {
    // Best-effort: clients still reconcile via the /state backstop. Surface the
    // failure to monitoring (no-op until a Sentry DSN is set).
    captureError(err, { scope: "realtime.broadcast" });
  }
}

/** Send a set of already-built messages in one batched HTTP request. */
export async function broadcastMessages(
  messages: BroadcastMessage[],
): Promise<void> {
  await broadcast(messages);
}

/**
 * Signal the public match channel that state advanced (spec/14 §B1). We send only
 * the new `lastSequence` — NOT the state — because the realtime transport is
 * untrusted (a client could forge a payload). Subscribers refetch authoritative
 * state from `GET /api/matches/[id]/state`, so a forged signal causes at most a
 * harmless refetch.
 */
export function stateUpdateMessage(
  matchId: string,
  lastSequence: number,
): BroadcastMessage {
  return {
    topic: `match:${matchId}`,
    event: "state-update",
    payload: { lastSequence },
  };
}

/** Serve-clock countdown with an absolute deadline (epoch ms). */
export function serveClockMessage(
  matchId: string,
  deadline: number,
  serveClockSecs: number,
): BroadcastMessage {
  return {
    topic: `match:${matchId}`,
    event: "serve-clock-start",
    payload: { deadline, serveClockSecs },
  };
}

/** Notify the scorer channel that a team tablet has raised an interrupt request. */
export async function broadcastInterruptRequest(
  matchId: string,
  payload: {
    requestId: string;
    team: "A" | "B";
    requestType: string;
  },
): Promise<void> {
  await broadcast([
    { topic: `match:${matchId}:scorer`, event: "interrupt-request", payload },
  ]);
}
