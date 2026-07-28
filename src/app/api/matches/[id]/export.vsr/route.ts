// VSR match-log export (spec/22): the full VolleyStation-style .vsr snapshot
// rebuilt from the event log — the same document the live dispatch ships to
// VIS after every action. Same authorization as the PDF exports.

import type { NextRequest } from "next/server";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import { resolveMatchConfig } from "@/lib/match-engine";
import { loadMatchReport, MatchReportNotFound } from "@/lib/match-report";
import { buildVsr, vsrFilename } from "@/lib/vsr/build";

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
    const [report, config] = await Promise.all([
      loadMatchReport(id),
      resolveMatchConfig(id),
    ]);
    const vsr = buildVsr(report, config);
    return new Response(JSON.stringify(vsr, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${vsrFilename(report)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof MatchReportNotFound)
      return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
