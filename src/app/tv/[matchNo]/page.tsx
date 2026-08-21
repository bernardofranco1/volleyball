/**
 * The TV overlay's output page (spec/47) — this is what goes to air.
 *
 * `/tv/{matchNo}?s={base64url stream}&delay={seconds}`
 *
 * Shaped after `/m/{matchNo}`: force-dynamic, noindex, the match resolved
 * through the same allowlist so the URL cannot render an arbitrary VIS match,
 * and `mock`/`replay` served from the embedded captures for rehearsal (spec/44).
 *
 * The initial board is fetched here so the graphics are correct on the very
 * first painted frame. An overlay that pops in a rally later is an overlay the
 * director has already cut away from.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { competitionForMatch } from "@/lib/vis-live/resolve";
import { MOCK_BOARD_TENANT } from "@/lib/board-host";
import {
  REPLAY_MATCH_NO,
  getBoard,
  getMatchList,
  getMockBoard,
  getReplayBoard,
  getVisCompetition,
} from "@/lib/vis-live/store";
import { MOCK_BOARD_MATCH_NO } from "@/components/scoreboard/VisBoardScreen";
import { decodeStreamParam, resolveStreamUrl } from "@/lib/tv/stream-url";
import { clampDelay } from "@/lib/tv/delay";
import { parseDemo } from "@/lib/tv/director";
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { TvViewer } from "@/components/tv/TvViewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TV Overlay",
  robots: { index: false, follow: false },
};

interface TvQuery {
  /** base64url of the resolved stream URL. */
  s?: string;
  /** Graphics delay in seconds, to match the stream's latency. */
  delay?: string;
  /** `vis` | `vs` — pin the feed, as the boards allow (spec/45 §6bis). */
  source?: string;
  /** Start with the graphics hidden, for a source that opens mid-programme. */
  hidden?: string;
  /** Force one graphic on for rehearsal: sub, challenge, review, success, fail,
   *  timeout, keymoment. */
  demo?: string;
}

export default async function TvOutputPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchNo: string }>;
  searchParams: Promise<TvQuery>;
}) {
  const { matchNo: raw } = await params;
  const q = await searchParams;

  const isMock = raw === "mock";
  const isReplay = raw === "replay";
  const synthetic = isMock || isReplay;
  if (!synthetic && !/^\d{1,9}$/.test(raw)) notFound();

  const ref = synthetic
    ? await MOCK_BOARD_TENANT()
    : await competitionForMatch(Number(raw));
  if (!ref) notFound();

  const matchNo = isMock
    ? MOCK_BOARD_MATCH_NO
    : isReplay
      ? REPLAY_MATCH_NO
      : Number(raw);

  const forcedSource = q.source === "vs" ? "vs" : q.source === "vis" ? "vis" : null;

  const comp = await getVisCompetition(ref.tenantId, ref.competitionId);
  if (!comp) notFound();

  // The match must belong to THIS competition's tournament — same check the
  // public board makes, for the same reason: the URL is public.
  if (!synthetic) {
    const schedule = await getMatchList(comp.visTournamentNo)
      .then((r) => r.value)
      .catch(() => []);
    if (schedule.length > 0 && !schedule.some((m) => m.matchNo === matchNo)) {
      notFound();
    }
  }

  const board = await (isMock
    ? Promise.resolve(getMockBoard())
    : isReplay
      ? Promise.resolve(getReplayBoard())
      : getBoard(matchNo, undefined, forcedSource)
  ).then(
    (r) => r.value,
    () => null,
  );
  if (!board) notFound();

  const streamUrl = decodeStreamParam(q.s);
  const resolved = streamUrl ? resolveStreamUrl(streamUrl) : null;
  const playable =
    resolved && (resolved.kind === "hls" || resolved.kind === "relay")
      ? resolved.url
      : null;

  const delay = clampDelay(q.delay);

  return (
    <>
      {/* The output fills the frame and the page behind it must be black, not
          the app's surface colour: any band of another colour round the picture
          is a band the vision mixer keys or crops. */}
      <style>
        {"html,body{background:#000!important;margin:0;overflow:hidden}" +
          // The homologation bar (spec/28) is on every other surface by design.
          // Here it would be composited into a programme feed, so it is hidden
          // and the operator panel reports the environment instead.
          "#env-banner{display:none!important}"}
      </style>
      <TvViewer
        boardId={synthetic ? raw : String(matchNo)}
        initialBoard={board}
        streamUrl={playable}
        streamNote={resolved?.kind === "unsupported" ? resolved.reason : null}
        initialDelay={delay}
        sourceParam={forcedSource}
        startHidden={q.hidden === "1"}
        demo={parseDemo(q.demo)}
        schema={IS_PROD_SCHEMA ? null : DB_SCHEMA}
      />
    </>
  );
}
