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
import { rateLimitPublicRead } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A `since`-bearing request is a polling *probe* from a backstop, so a shared
// edge answer up to a second old is harmless and lets a stand full of phones
// polling the same sequence collapse onto one origin hit (spec/24 §9.5 F2).
// Deliberately NOT applied to requests without `since`: those are the mount
// fetch and — critically — the refetch a client makes the instant a realtime
// broadcast says the score moved. Serving that from cache would hand back the
// pre-point state, the client's monotonic guard would discard it, and the board
// would sit stale until the next backstop tick. No stale-while-revalidate for
// the same reason: it would widen the window a poll-mode TV can lag by.
const PROBE_CACHE = "public, s-maxage=1";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimitPublicRead(`state:${ip}:${id}`)))
    return Response.json({ error: "Too many requests" }, { status: 429 });

  try {
    const sinceRaw = req.nextUrl.searchParams.get("since");
    const isProbe = sinceRaw != null;
    if (isProbe) {
      const since = Number.parseInt(sinceRaw, 10);
      if (Number.isFinite(since) && (await latestSequence(id)) <= since) {
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": PROBE_CACHE },
        });
      }
    }
    const { state, config } = await loadMatchState(id);
    // serverNow lets clients offset device-clock skew when they turn event
    // timestamps into countdown deadlines (boards/tablets on drifting clocks).
    return Response.json(
      { state, config, serverNow: Date.now() },
      {
        headers: {
          "Cache-Control": isProbe ? PROBE_CACHE : "no-store",
        },
      },
    );
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof UnsupportedDisciplineError)
      return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
