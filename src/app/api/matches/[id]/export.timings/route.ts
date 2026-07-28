// Timing export (spec/22): the full timing breakdown of a match — per rally,
// per set, per break (timeouts, TTOs, medical, video challenges, set breaks) —
// as JSON, derivable at any moment and final once the match ends.

import type { NextRequest } from "next/server";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import { loadMatchReport, MatchReportNotFound } from "@/lib/match-report";
import { computeMatchTimings } from "@/lib/timings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  try {
    const report = await loadMatchReport(id);
    const timings = computeMatchTimings(report);
    return new Response(JSON.stringify(timings, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="match-${id}-timings.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof MatchReportNotFound)
      return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
