/**
 * Dependency status for the venue boards (spec/41). Public and read-only, like
 * the boards themselves: venue staff need it without an account and it carries
 * no secrets — a schema name and a commit, both of which /api/version already
 * says, plus timings and cache ages.
 *
 * `?probe=1` adds one live VIS call. Off by default so a status page left open
 * on a desk does not add a request per refresh to the feed it is watching.
 */

import { readBoardStatus } from "@/lib/board-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = await readBoardStatus({
    origin: url.origin,
    probe: url.searchParams.get("probe") === "1",
  });
  return Response.json(status, {
    // 503 when boards are not updating, so an uptime monitor pointed here
    // becomes alerting without another line of code from us.
    status: status.overall === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
