"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { channelConfig, ensureRealtimeAuth } from "@/lib/realtime-client";
import { type BeachMatchState, activeSet } from "@/engine/beach/types";
import {
  BroadcastBoard,
  type BoardTheme,
  DEFAULT_BOARD_THEME,
} from "@/components/scoreboard/BroadcastBoard";
import { useCountdown, formatCountdown } from "@/components/scoreboard/Countdown";

// Display modes are retained for URL compatibility; the broadcast board always
// shows score + sets + serving, so they no longer change the layout.
export type DisplayMode =
  | "SCORE_ONLY"
  | "SCORE_WITH_SETS"
  | "SCORE_WITH_ROTATION";

export function ScoreboardDisplay({
  matchId,
  initialState,
  teamAName,
  teamBName,
  logoUrl,
  accentColor,
  teamAColor,
  teamBColor,
  scheduledAtMs,
  mode,
  poll,
  basePath,
}: {
  matchId: string;
  initialState: BeachMatchState;
  teamAName: string;
  teamBName: string;
  competitionName: string;
  tenantName: string;
  logoUrl: string | null;
  accentColor: string | null;
  teamAColor: string | null;
  teamBColor: string | null;
  scheduledAtMs: number | null;
  timeoutsPerSet: number;
  mode: DisplayMode;
  poll: boolean;
  basePath: string;
}) {
  const [state, setState] = useState<BeachMatchState>(initialState);
  const [timeoutInfo, setTimeoutInfo] = useState<{
    deadline: number;
    team: "A" | "B";
  } | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Authoritative state from /state (the realtime channel only signals changes —
  // spec/14 §B1 — so a forged broadcast can't push fake state to a TV).
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/state`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { state: BeachMatchState };
      if (data.state.lastSequence >= stateRef.current.lastSequence)
        setState(data.state);
    } catch {
      /* keep last good state */
    }
  }, [matchId]);

  // Live updates: HTTP polling fallback for unreliable WebSocket environments
  // (TVs/projectors), otherwise the public Supabase Realtime signal channel.
  useEffect(() => {
    if (poll) {
      // Defer the first poll (not a synchronous setState in the effect body).
      const first = setTimeout(fetchState, 0);
      const id = setInterval(fetchState, 3000);
      return () => {
        clearTimeout(first);
        clearInterval(id);
      };
    }
    const supabase = createSupabaseBrowserClient();
    ensureRealtimeAuth(supabase);
    const channel = supabase
      .channel(`match:${matchId}`, channelConfig())
      .on(
        "broadcast",
        { event: "state-update" },
        (msg: { payload?: { lastSequence?: number } }) => {
          const seq = msg.payload?.lastSequence;
          if (typeof seq === "number" && seq > stateRef.current.lastSequence)
            void fetchState();
        },
      )
      .on(
        "broadcast",
        { event: "timeout-start" },
        (msg: { payload?: { deadline?: number; team?: "A" | "B" } }) => {
          const p = msg.payload;
          if (
            typeof p?.deadline === "number" &&
            (p.team === "A" || p.team === "B")
          )
            setTimeoutInfo({ deadline: p.deadline, team: p.team });
        },
      )
      .subscribe();
    // Realtime is the instant path, but broadcasts are fire-and-forget — fetch
    // once on mount and run a slow backstop so a missed signal never leaves the
    // board stale (brief §4.2).
    const first = setTimeout(fetchState, 0);
    const backstop = setInterval(fetchState, 10000);
    return () => {
      clearTimeout(first);
      clearInterval(backstop);
      void supabase.removeChannel(channel);
    };
  }, [matchId, poll, fetchState]);

  const set = activeSet(state);
  const finished = state.status === "FINISHED";

  const theme: BoardTheme = {
    ...DEFAULT_BOARD_THEME,
    ...(accentColor ? { accent: accentColor, line: accentColor } : {}),
  };

  // Pre-match countdown to scheduled start (§4.4) + team time-out countdown (§4.3).
  const preMatchMs = useCountdown(
    scheduledAtMs && !finished && state.status !== "LIVE" ? scheduledAtMs : null,
  );
  const timeoutMs = useCountdown(timeoutInfo?.deadline ?? null);
  const timeoutTeam = timeoutInfo?.team ?? null;
  const showTimeout =
    timeoutMs > 0 && state.rallyPhase === "TIMEOUT_ACTIVE" && timeoutTeam != null;
  const showPreMatch =
    preMatchMs > 0 && !finished && state.status !== "LIVE" && scheduledAtMs != null;

  return (
    <>
      <BroadcastBoard
        teamAName={teamAName}
        teamBName={teamBName}
        teamAColor={teamAColor}
        teamBColor={teamBColor}
        setsWonA={state.setsWonA}
        setsWonB={state.setsWonB}
        scoreA={set?.scoreA ?? 0}
        scoreB={set?.scoreB ?? 0}
        serving={set?.currentServer ?? null}
        setNumber={set?.setNumber ?? null}
        sets={state.sets.map((s) => ({
          setNumber: s.setNumber,
          scoreA: s.scoreA,
          scoreB: s.scoreB,
          winner: s.winner,
        }))}
        logoUrl={logoUrl}
        finished={finished}
        theme={theme}
      />

      {showPreMatch ? (
        <div className="fixed left-1/2 top-8 z-[55] -translate-x-1/2 rounded-2xl border border-border bg-surface-raised/90 px-8 py-3 text-center backdrop-blur">
          <div className="text-xs uppercase tracking-[0.3em] text-score-dim">
            Starts in
          </div>
          <div className="font-mono text-4xl font-bold tabular-nums">
            {formatCountdown(preMatchMs)}
          </div>
        </div>
      ) : null}

      {showTimeout ? (
        <div
          className={`fixed bottom-24 z-[55] rounded-2xl border-2 border-primary bg-surface-raised/95 px-8 py-3 text-center backdrop-blur ${
            timeoutTeam === "A" ? "left-12" : "right-12"
          }`}
        >
          <div className="text-xs uppercase tracking-[0.3em] text-primary">
            {timeoutTeam === "A" ? teamAName : teamBName} · Time-out
          </div>
          <div className="font-mono text-5xl font-bold tabular-nums">
            {formatCountdown(timeoutMs)}
          </div>
        </div>
      ) : null}

      {/* Low-key live/poll toggle (TVs that can't hold a WebSocket). */}
      <nav className="fixed right-3 top-3 z-[60] opacity-20 transition-opacity hover:opacity-100">
        <Link
          href={`${basePath}?display=${mode}${poll ? "" : "&mode=poll"}`}
          className={`rounded border px-2 py-0.5 text-xs ${
            poll
              ? "border-amber-500 text-amber-400"
              : "border-white/40 text-white/60"
          }`}
          title="Toggle HTTP polling fallback"
        >
          {poll ? "poll" : "live"}
        </Link>
      </nav>
    </>
  );
}
