// Server-side Supabase Realtime broadcast helpers.
//
// Uses the Realtime HTTP broadcast endpoint (no websocket needed server-side,
// which suits serverless route handlers). Authenticated with the service/secret
// key. Broadcast failures are swallowed — the SSE stream and client resync are
// the fallback, so a realtime hiccup must never fail a scoring request.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type BroadcastMessage = {
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
  } catch {
    // Best-effort: clients still receive updates via the SSE stream / resync.
  }
}

/** Push the new match state to the public match channel (scoreboard, spectators). */
export async function broadcastState(
  matchId: string,
  payload: unknown,
): Promise<void> {
  await broadcast([
    { topic: `match:${matchId}`, event: "state-update", payload },
  ]);
}

/** Announce a serve-clock countdown with an absolute deadline (epoch ms). */
export async function broadcastServeClock(
  matchId: string,
  deadline: number,
  serveClockSecs: number,
): Promise<void> {
  await broadcast([
    {
      topic: `match:${matchId}`,
      event: "serve-clock-start",
      payload: { deadline, serveClockSecs },
    },
  ]);
}
