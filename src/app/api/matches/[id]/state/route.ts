// State resync: snapshot + tail replay, returning current state + config.
// Used by clients on reconnect, by the 25s reconcile backstop on every open
// scoreboard/scorer, and by team tablets on mount.
//
// Deliberately UNAUTHENTICATED — the public scoreboard and results surfaces
// consume it — but rate-limited per IP+match, and it supports a `?since=<seq>`
// fast path (204 when the caller is already up to date) so the polling
// backstop costs one indexed MAX() instead of a snapshot load + replay.

import type { NextRequest } from "next/server";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  latestSequence,
  loadMatchState,
} from "@/lib/match-engine";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimit(`state:${ip}:${id}`)))
    return Response.json({ error: "Too many requests" }, { status: 429 });

  try {
    const sinceRaw = req.nextUrl.searchParams.get("since");
    if (sinceRaw != null) {
      const since = Number.parseInt(sinceRaw, 10);
      if (Number.isFinite(since) && (await latestSequence(id)) <= since) {
        return new Response(null, { status: 204 });
      }
    }
    const { state, config } = await loadMatchState(id);
    // serverNow lets clients offset device-clock skew when they turn event
    // timestamps into countdown deadlines (boards/tablets on drifting clocks).
    return Response.json({ state, config, serverNow: Date.now() });
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof UnsupportedDisciplineError)
      return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
