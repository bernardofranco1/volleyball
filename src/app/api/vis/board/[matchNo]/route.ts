/**
 * Board payload for one VIS match (spec/34). Public and read-only: the boards
 * are TV displays with no session, exactly like /t/{slug}/scoreboard.
 *
 * The allowlist check is load-bearing — without it this route would relay any
 * match number in VIS to anyone who asks.
 */

import { NextResponse } from "next/server";
import {
  getBoard,
  getMockBoard,
  getReplayBoard,
  isKnownMatch,
} from "@/lib/vis-live/store";
import { cdnMaxAgeSeconds, pollIntervalMs } from "@/lib/vis-live/cadence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchNo: string }> },
) {
  const { matchNo: raw } = await params;
  // The validation mock (spec/35 W9) is served from the embedded capture: no
  // VIS call, no allowlist, never cached.
  if (raw === "mock") {
    const { value, ageSeconds } = getMockBoard();
    return NextResponse.json(
      { board: value, ageSeconds, pollMs: pollIntervalMs(value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // The replay board (spec/44): a real match on a loop, also without VIS — but
  // through the real pipeline, so it carries the real cadence and CDN headers.
  if (raw === "replay") {
    const url = new URL(req.url);
    const speed = Number(url.searchParams.get("speed"));
    const { value, ageSeconds } = getReplayBoard(Date.now(), {
      chaos: url.searchParams.has("chaos"),
      speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
    });
    const interval = pollIntervalMs(value);
    return NextResponse.json(
      { board: value, ageSeconds, pollMs: interval },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${cdnMaxAgeSeconds(interval)}, stale-while-revalidate=${cdnMaxAgeSeconds(interval) * 2}`,
        },
      },
    );
  }
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
    // A per-screen source override (spec/45 §6bis): two TVs on the same match,
    // one per feed, is how the two are compared during an event.
    const raw = new URL(req.url).searchParams.get("source");
    const requested = raw === "vs" ? "vs" : raw === "vis" ? "vis" : null;
    const { value, ageSeconds, source } = await getBoard(matchNo, Date.now(), requested);
    const interval = pollIntervalMs(value);
    const maxAge = cdnMaxAgeSeconds(interval);
    return NextResponse.json(
      { board: value, ageSeconds, pollMs: interval, source },
      {
        headers: {
          // The CDN soaks up per-TV polling; the store's TTL bounds upstream
          // calls. Both follow the same cadence as the browser's timer, so a
          // live board is one second behind VIS rather than one second behind a
          // five-second cache behind a twenty-second TTL (spec/37).
          //
          // `?source=` is part of the cache key on Vercel, so the two variants
          // of one match cache independently — which is what makes the
          // side-by-side comparison cheap rather than cache-thrashing.
          "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
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
