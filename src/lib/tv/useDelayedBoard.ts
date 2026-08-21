"use client";

/**
 * Poll the board, then hand back the board as it was N seconds ago (spec/47).
 *
 * This is the part of the overlay that makes it usable rather than merely
 * correct. HLS puts the picture 10-30 seconds behind the hall; the data feed is
 * 1-3 seconds behind it. Rendered naively, the score on the overlay ticks over
 * while the rally that scored it is still being played on screen — which looks
 * less like a delay and more like a broken graphic, and no amount of "it is the
 * stream's fault" makes it usable in a gallery.
 *
 * So every frame is kept with the time it arrived, and the frame served is the
 * newest one at or before `now - delay`. The operator dials `delay` in once, by
 * watching a point land, and everything downstream — the score, the
 * substitutions, the challenge card — is consistent because it all comes off
 * the same delayed frame.
 *
 * Polling deliberately does NOT pause on a hidden tab, which is the one thing it
 * does differently from VisBoardDisplay. A venue board that nobody is looking at
 * can stop; a TV output feeding a programme cannot, and an operator with the tab
 * behind their vision mixer would come back to a graphic that had stopped
 * updating and a buffer with a hole in it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import { pollIntervalMs } from "@/lib/vis-live/cadence";
import { MAX_DELAY_S } from "@/lib/tv/delay";

/** Doubling backoff while the board endpoint is failing. */
const FAIL_BACKOFF_MIN_MS = 3_000;
const FAIL_BACKOFF_MAX_MS = 30_000;
/** Trim beyond this: the buffer is a ring, not a match log. */
const BUFFER_MS = (MAX_DELAY_S + 30) * 1000;

interface Frame {
  at: number;
  board: VisBoardData;
}

export interface DelayedBoard {
  /** The frame to draw: what the feed said `delay` seconds ago. */
  board: VisBoardData;
  /** The newest frame, for the operator panel — never for the graphics. */
  live: VisBoardData;
  /** Seconds since the last successful poll, or null when healthy. */
  staleFor: number | null;
  /** Frames held. Shown in the operator panel so a short buffer is visible. */
  buffered: number;
}

export function useDelayedBoard(
  boardId: string,
  initialBoard: VisBoardData,
  delaySeconds: number,
  sourceParam: "vis" | "vs" | null = null,
): DelayedBoard {
  const [frames, setFrames] = useState<Frame[]>(() => [
    { at: Date.now(), board: initialBoard },
  ]);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  // A clock of its own, so the delayed view advances between polls: with a 20 s
  // delay and a 1 s poll, the frame that is "now - 20s" changes on the clock,
  // not on the fetch.
  const [tick, setTick] = useState(() => Date.now());
  const nextDelayRef = useRef(pollIntervalMs(initialBoard));

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/vis/board/${boardId}${sourceParam ? `?source=${sourceParam}` : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { board?: VisBoardData; pollMs?: number };
      if (data?.board) {
        const board = data.board;
        const at = Date.now();
        setFrames((prev) => {
          // Identical payloads are the common case at one read a second. Keep
          // ONE frame per distinct state but re-stamp nothing: the arrival time
          // of the first frame that said this is when it became true, and that
          // is what the delay has to be measured from.
          const last = prev[prev.length - 1];
          const next =
            last && JSON.stringify(last.board) === JSON.stringify(board)
              ? prev
              : [...prev, { at, board }];
          const cutoff = at - BUFFER_MS;
          const from = next.findIndex((f) => f.at >= cutoff);
          // Keep one frame older than the cutoff: it is the one still being
          // shown when the delay is at its maximum.
          return from > 1 ? next.slice(from - 1) : next;
        });
        setStaleSince(null);
      }
      nextDelayRef.current =
        data?.pollMs ?? (data?.board ? pollIntervalMs(data.board) : nextDelayRef.current);
    } catch {
      setStaleSince((prev) => prev ?? Date.now());
      nextDelayRef.current = Math.min(
        FAIL_BACKOFF_MAX_MS,
        Math.max(FAIL_BACKOFF_MIN_MS, nextDelayRef.current * 2),
      );
    }
  }, [boardId, sourceParam]);

  // Self-scheduling, because the interval changes with the match state.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      timer = setTimeout(() => void run(), nextDelayRef.current);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  // 4 Hz: fine enough that a graphic fires within a quarter-second of its mark,
  // coarse enough to be free.
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const target = tick - delaySeconds * 1000;
  let shown = frames[0];
  for (const f of frames) {
    if (f.at <= target) shown = f;
    else break;
  }

  return {
    board: shown?.board ?? initialBoard,
    // The newest frame IS the live board — no separate ref needed, and reading
    // one during render is exactly what React warns about.
    live: frames[frames.length - 1]?.board ?? initialBoard,
    staleFor: staleSince == null ? null : Math.round((tick - staleSince) / 1000),
    buffered: frames.length,
  };
}
