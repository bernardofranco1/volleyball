"use client";

/**
 * Live wrapper around VisBoard (spec/34): polls the board API and re-renders.
 *
 * Deliberately dumb — no realtime channel, no optimistic state. VIS is the only
 * source, its `PollDelay` is the real cadence, and the server-side store makes
 * every viewer cheap. The client polls a little faster than PollDelay so a
 * refreshed upstream payload reaches the TV promptly; the store, not this
 * interval, is what bounds calls to VIS.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import { VisBoard, type VisBoardTheme } from "@/components/scoreboard/VisBoard";

const POLL_MS = 10_000;
/** Only admit to a problem once it has persisted; VIS blips constantly. */
const STALE_NOTICE_MS = 60_000;

export function VisBoardDisplay({
  matchNo,
  initialBoard,
  theme,
  backgroundUrl,
  logoUrl,
  scheduledFallback,
}: {
  matchNo: number;
  initialBoard: VisBoardData;
  theme?: VisBoardTheme;
  backgroundUrl?: string | null;
  logoUrl?: string | null;
  scheduledFallback?: string | null;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
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
        setBoard(data.board);
        setStaleSince(null);
      }
    } catch {
      // Keep the last good board on screen — a blank TV in a full arena is the
      // worst possible outcome. Only note the age once it starts to matter.
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

  // Ticks only while something is wrong, so the notice can count up.
  useEffect(() => {
    if (staleSince == null) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [staleSince]);

  const staleFor = staleSince == null ? 0 : now - staleSince;
  const notice =
    staleFor >= STALE_NOTICE_MS
      ? `no signal for ${Math.round(staleFor / 1000)}s`
      : null;

  return (
    <VisBoard
      board={board}
      theme={theme}
      backgroundUrl={backgroundUrl}
      logoUrl={logoUrl}
      notice={notice}
      scheduledFallback={scheduledFallback}
    />
  );
}
