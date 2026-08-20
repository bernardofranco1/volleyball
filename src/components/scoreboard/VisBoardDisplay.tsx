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
 * Deliberately dumb data-wise: VIS is the only source and the server store makes
 * viewers cheap. On fetch failure the last good screen stays up — a blank TV in
 * a full arena is the worst outcome — with a small "no signal" note after a
 * minute.
 *
 * CADENCE (spec/37): the poll interval is not fixed. While a set is being played
 * the board asks every second, so a point lands on the screen at about the same
 * time the crowd reacts to it; in a set break, before the first whistle and
 * after the match it backs off hard, because nothing changes second to second
 * and there is no reason to spend either VIS's capacity or ours. The interval
 * comes from the payload itself (`pollMs`), so the server decides it and all
 * three caches agree. Polling stops entirely while the tab is hidden and
 * resumes with an immediate read — a venue TV never hides, an operator's laptop
 * tab does.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import { pollIntervalMs } from "@/lib/vis-live/cadence";
import type { VisBoardTheme } from "@/components/scoreboard/vis-board-theme";
import { VisBoard } from "@/components/scoreboard/VisBoard";
import { VisBoardUShape } from "@/components/scoreboard/VisBoardUShape";
import { VisSetStats } from "@/components/scoreboard/VisSetStats";

const STALE_NOTICE_MS = 60_000;
/** The final score lingers this long before the stats screen takes over. */
const STATS_DELAY_MS = 10_000;
/** Doubling backoff while the board endpoint is failing. */
const FAIL_BACKOFF_MIN_MS = 3_000;
const FAIL_BACKOFF_MAX_MS = 30_000;

export type VisLayout = "full" | "ushape";
export type VisScreenOverride = "board" | "stats" | null;

export function VisBoardDisplay({
  matchNo,
  boardId,
  sourceParam = null,
  initialBoard,
  layout = "full",
  screenOverride = null,
  theme,
  backgroundUrl,
  logoUrl,
  windowFill = "transparent",
  replica = false,
  notice: noticeOverride = null,
}: {
  matchNo: number;
  /**
   * The `/api/vis/board/{…}` segment to poll, when it is not the match number:
   * "mock" and "replay" are served from embedded captures and never reach VIS.
   * Without this the mock polled the REAL match 21546 from its second frame on,
   * which is not what spec/35 W9 promises.
   */
  boardId?: string;
  /**
   * `vis` | `vs` when this screen is pinned to one feed (spec/45 §6bis). It is
   * carried on every poll, and shown as a small tag — a screen deliberately
   * running the other source should say so, or a comparison becomes an
   * argument about which window was which.
   */
  sourceParam?: "vis" | "vs" | null;
  initialBoard: VisBoardData;
  layout?: VisLayout;
  /** Pin one screen (?screen=board|stats) — overrides the rotation. */
  screenOverride?: VisScreenOverride;
  theme?: VisBoardTheme;
  backgroundUrl?: string | null;
  /** Event mark for the stats screen (the scoreboard master carries none). */
  logoUrl?: string | null;
  windowFill?: "transparent" | "black";
  /** Replica mode for the pixel-diff gate (spec/35 W8). */
  replica?: boolean;
  /** Always-on marker, e.g. the validation mock's label (spec/35 W9). */
  notice?: string | null;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // When we WITNESSED the current break/final begin — null when play is on or
  // when the page loaded into an already-ended state (skip the delay then).
  const [endSeenAt, setEndSeenAt] = useState<number | null>(null);
  const boardRef = useRef(board);
  // How long to wait before the next read. Seeded from the state the page was
  // server-rendered in, then replaced by whatever the server last advertised.
  const nextDelayRef = useRef(pollIntervalMs(initialBoard));
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/vis/board/${boardId ?? matchNo}${sourceParam ? `?source=${sourceParam}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { board: VisBoardData; pollMs?: number };
      if (data?.board) {
        const prev = boardRef.current;
        const prevEnded = prev.inSetBreak || prev.status === "FINISHED";
        const nowEnded = data.board.inSetBreak || data.board.status === "FINISHED";
        if (!prevEnded && nowEnded) setEndSeenAt(Date.now());
        if (!nowEnded) setEndSeenAt(null);
        // At one read a second most payloads are byte-identical. Skipping the
        // state update keeps an idle board from re-rendering 60 times a minute
        // for nothing; the comparison is a few KB and far cheaper than the DOM
        // work it avoids.
        if (JSON.stringify(data.board) !== JSON.stringify(prev)) setBoard(data.board);
        setStaleSince(null);
      }
      // The server owns the cadence; trust its figure and fall back to our own
      // reading of the same rule if an older deployment omits it.
      nextDelayRef.current = data?.pollMs
        ?? (data?.board ? pollIntervalMs(data.board) : nextDelayRef.current);
    } catch {
      setStaleSince((prev) => prev ?? Date.now());
      // Back off while the endpoint is down. Polling a failing route once a
      // second helps nobody and turns one outage into two.
      nextDelayRef.current = Math.min(
        FAIL_BACKOFF_MAX_MS,
        Math.max(FAIL_BACKOFF_MIN_MS, nextDelayRef.current * 2),
      );
    }
  }, [boardId, matchNo, sourceParam]);

  // Self-scheduling timer rather than setInterval: the delay changes with the
  // match state, and an interval cannot be re-timed without tearing it down.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        // Nothing to show; wake on visibilitychange instead of burning polls.
        return;
      }
      await poll();
      if (stopped) return;
      timer = setTimeout(() => void tick(), nextDelayRef.current);
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
  const stale =
    staleFor >= STALE_NOTICE_MS
      ? `no signal for ${Math.round(staleFor / 1000)}s`
      : null;
  // A permanent marker (the mock) and a transient one (lost signal) can both
  // apply; show both rather than letting either hide the other.
  const notice = [noticeOverride, stale].filter(Boolean).join("  ·  ") || null;

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
      replica={replica}
    />
  );
}
