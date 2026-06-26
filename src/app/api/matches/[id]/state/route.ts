// Full state resync: replays the entire event log and returns current state.
// Used by clients on reconnect and by team tablets on mount.

import type { NextRequest } from "next/server";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchStateFresh,
} from "@/lib/match-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const { state, config } = await loadMatchStateFresh(id);
    return Response.json({ state, config });
  } catch (err) {
    if (err instanceof MatchNotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof UnsupportedDisciplineError)
      return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
