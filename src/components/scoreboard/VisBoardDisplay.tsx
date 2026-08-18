"use client";

/**
 * Live wrapper around the VIS boards (spec/34): polls the board API and picks
 * which screen the venue sees.
 *
 * Screens & rotation (full layout only):
 *   scoreboard  — the default while a set is on.
 *   set stats   — 10 seconds AFTER a set ends the screen switches to the
 *                 team-statistics view (the AVC Set master); the moment the
 *                 next set begins it snaps back to the scoreboard. A page
 *                 loaded mid-break skips the 10 s (the pause exists so the
 *                 final score lingers, and it already has). After the match
 *                 the stats screen stays, headlining the result.
 * The U-shape layout never rotates — its centre window frames the TV feed,
 * and covering the feed with a stats card would defeat it.
 *
 * Deliberately dumb data-wise: VIS is the only source, its PollDelay the real
 * cadence, the server store makes viewers cheap. On fetch failure the last
 * good screen stays up — a blank TV in a full arena is the worst outcome —
 * with a small "no signal" note after a minute.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import type { VisBoardTheme } from "@/components/scoreboard/vis-board-theme";
import { VisBoard } from "@/components/scoreboard/VisBoard";
import { VisBoardUShape } from "@/components/scoreboard/VisBoardUShape";
import { VisSetStats } from "@/components/scoreboard/VisSetStats";

const POLL_MS = 10_000;
const STALE_NOTICE_MS = 60_000;
/** The final score lingers this long before the stats screen takes over. */
const STATS_DELAY_MS = 10_000;

export type VisLayout = "full" | "ushape";
export type VisScreenOverride = "board" | "stats" | null;

export function VisBoardDisplay({
  matchNo,
  initialBoard,
  layout = "full",
  screenOverride = null,
  theme,
  backgroundUrl,
  logoUrl,
  windowFill = "transparent",
  scheduledFallback,
}: {
  matchNo: number;
  initialBoard: VisBoardData;
  layout?: VisLayout;
  /** Pin one screen (?screen=board|stats) — overrides the rotation. */
  screenOverride?: VisScreenOverride;
  theme?: VisBoardTheme;
  backgroundUrl?: string | null;
  /** Event mark for the stats screen (the scoreboard master carries none). */
  logoUrl?: string | null;
  windowFill?: "transparent" | "black";
  scheduledFallback?: string | null;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // When we WITNESSED the current break/final begin — null when play is on or
  // when the page loaded into an already-ended state (skip the delay then).
  const [endSeenAt, setEndSeenAt] = useState<number | null>(null);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/vis/board/${matchNo}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { board: VisBoardData };
      if (data?.board) {
        const prev = boardRef.current;
        const prevEnded = prev.inSetBreak || prev.status === "FINISHED";
        const nowEnded = data.board.inSetBreak || data.board.status === "FINISHED";
        if (!prevEnded && nowEnded) setEndSeenAt(Date.now());
        if (!nowEnded) setEndSeenAt(null);
        setBoard(data.board);
        setStaleSince(null);
      }
    } catch {
      setStaleSince((prev) => prev ?? Date.now());
    }
  }, [matchNo]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll]);

  // A 1s tick only while something time-dependent is pending (the 10 s stats
  // delay, or the "no signal" counter) — an idle board re-renders on polls only.
  const waitingOnDelay =
    endSeenAt != null && now - endSeenAt < STATS_DELAY_MS + 1_000;
  useEffect(() => {
    if (staleSince == null && !waitingOnDelay) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [staleSince, waitingOnDelay]);

  const staleFor = staleSince == null ? 0 : now - staleSince;
  const notice =
    staleFor >= STALE_NOTICE_MS
      ? `no signal for ${Math.round(staleFor / 1000)}s`
      : null;

  const ended = board.inSetBreak || board.status === "FINISHED";
  const delayPassed = endSeenAt == null || now - endSeenAt >= STATS_DELAY_MS;
  const screen: "board" | "stats" =
    screenOverride ??
    (layout === "full" && ended && delayPassed ? "stats" : "board");

  if (layout === "ushape") {
    return (
      <VisBoardUShape
        board={board}
        theme={theme}
        backgroundUrl={backgroundUrl}
        windowFill={windowFill}
        notice={notice}
      />
    );
  }
  if (screen === "stats") {
    return (
      <VisSetStats
        board={board}
        theme={theme}
        backgroundUrl={backgroundUrl}
        logoUrl={logoUrl}
        notice={notice}
      />
    );
  }
  return (
    <VisBoard
      board={board}
      theme={theme}
      backgroundUrl={backgroundUrl}
      notice={notice}
      scheduledFallback={scheduledFallback}
    />
  );
}
