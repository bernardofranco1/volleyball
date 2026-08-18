/**
 * Board payload for one VIS match (spec/34). Public and read-only: the boards
 * are TV displays with no session, exactly like /t/{slug}/scoreboard.
 *
 * The allowlist check is load-bearing — without it this route would relay any
 * match number in VIS to anyone who asks.
 */

import { NextResponse } from "next/server";
import { getBoard, isKnownMatch } from "@/lib/vis-live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchNo: string }> },
) {
  const { matchNo: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) {
    return NextResponse.json({ error: "bad match number" }, { status: 400 });
  }
  const matchNo = Number(raw);

  try {
    if (!(await isKnownMatch(matchNo))) {
      return NextResponse.json({ error: "unknown match" }, { status: 404 });
    }
  } catch {
    // The allowlist needs VIS + the DB; if it can't be built we cannot claim
    // the match is unknown, so fall through and let getBoard decide.
  }

  try {
    const { value, ageSeconds } = await getBoard(matchNo);
    return NextResponse.json(
      { board: value, ageSeconds },
      {
        headers: {
          // The CDN soaks up per-TV polling; the store's own TTL is what
          // actually bounds upstream calls to one per PollDelay.
          "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "VIS unavailable" },
      { status: 503 },
    );
  }
}
