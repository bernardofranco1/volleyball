"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { channelConfig, ensureRealtimeAuth } from "@/lib/realtime-client";
import {
  type BeachMatchState,
  activeSet,
} from "@/engine/beach/types";

export type DisplayMode =
  | "SCORE_ONLY"
  | "SCORE_WITH_SETS"
  | "SCORE_WITH_ROTATION";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "SCORE_ONLY", label: "Score" },
  { key: "SCORE_WITH_SETS", label: "+ Sets" },
  { key: "SCORE_WITH_ROTATION", label: "+ Server" },
];

export function ScoreboardDisplay({
  matchId,
  initialState,
  teamAName,
  teamBName,
  competitionName,
  tenantName,
  logoUrl,
  timeoutsPerSet,
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
  timeoutsPerSet: number;
  mode: DisplayMode;
  poll: boolean;
  basePath: string;
}) {
  const [state, setState] = useState<BeachMatchState>(initialState);
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

  const linkFor = (m: DisplayMode) =>
    `${basePath}?display=${m}${poll ? "&mode=poll" : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-auto bg-surface text-foreground">
      {/* Header */}
      <header className="flex items-center justify-center gap-4 border-b border-border px-6 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-8 w-auto" />
        ) : null}
        <span className="text-[clamp(0.9rem,2.5vw,1.6rem)] font-semibold tracking-wide">
          {competitionName}
        </span>
        <span className="text-[clamp(0.7rem,1.6vw,1rem)] text-score-dim">
          {tenantName}
        </span>
      </header>

      {/* Main: two team panels */}
      <main className="grid flex-1 grid-cols-2">
        <TeamPanel
          name={teamAName}
          setsWon={state.setsWonA}
          score={set?.scoreA ?? 0}
          serving={set?.currentServer === "A"}
          serverPlayer={set?.serverPlayerA ?? null}
          timeoutsLeft={
            set ? Math.max(0, timeoutsPerSet - set.timeoutsUsedA) : timeoutsPerSet
          }
          timeoutsPerSet={timeoutsPerSet}
          showServer={mode === "SCORE_WITH_ROTATION"}
          winner={finished && state.winner === "A"}
        />
        <TeamPanel
          name={teamBName}
          setsWon={state.setsWonB}
          score={set?.scoreB ?? 0}
          serving={set?.currentServer === "B"}
          serverPlayer={set?.serverPlayerB ?? null}
          timeoutsLeft={
            set ? Math.max(0, timeoutsPerSet - set.timeoutsUsedB) : timeoutsPerSet
          }
          timeoutsPerSet={timeoutsPerSet}
          showServer={mode === "SCORE_WITH_ROTATION"}
          winner={finished && state.winner === "B"}
          borderLeft
        />
      </main>

      {/* Footer: set / status + match clock */}
      <footer className="flex items-center justify-between border-t border-border px-6 py-3 text-[clamp(0.8rem,2vw,1.4rem)] text-score-dim">
        <span>
          {finished
            ? "Final"
            : set
              ? `Set ${set.setNumber}`
              : "Match not started"}
          {set?.ttoFired ? " · TTO done" : ""}
        </span>
        <MatchClock
          startedAt={state.matchStartedAt}
          endedAt={finished ? lastSetEnd(state) : null}
        />
      </footer>

      {/* Set history strip */}
      {mode === "SCORE_WITH_SETS" && state.sets.length > 0 ? (
        <div className="flex justify-center gap-3 border-t border-border bg-surface-raised px-6 py-3">
          {state.sets.map((s) => (
            <div
              key={s.setNumber}
              className="rounded-lg border border-border px-4 py-1 text-center"
            >
              <div className="text-[10px] uppercase tracking-wide text-score-dim">
                Set {s.setNumber}
              </div>
              <div className="font-mono text-[clamp(1rem,3vw,2rem)] tabular-nums">
                {s.scoreA}–{s.scoreB}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Mode controls (low-key overlay; hidden on hover-less idle) */}
      <nav className="absolute right-3 top-3 flex gap-1 opacity-30 transition-opacity hover:opacity-100">
        {MODES.map((m) => (
          <Link
            key={m.key}
            href={linkFor(m.key)}
            className={`rounded border px-2 py-0.5 text-xs ${
              m.key === mode
                ? "border-primary text-foreground"
                : "border-border text-score-dim"
            }`}
          >
            {m.label}
          </Link>
        ))}
        <Link
          href={`${basePath}?display=${mode}${poll ? "" : "&mode=poll"}`}
          className={`rounded border px-2 py-0.5 text-xs ${
            poll ? "border-amber-500 text-amber-400" : "border-border text-score-dim"
          }`}
          title="Toggle HTTP polling fallback"
        >
          {poll ? "poll" : "live"}
        </Link>
      </nav>
    </div>
  );
}

function lastSetEnd(state: BeachMatchState): string | null {
  for (let i = state.sets.length - 1; i >= 0; i--) {
    if (state.sets[i].endedAt) return state.sets[i].endedAt;
  }
  return null;
}

function TeamPanel({
  name,
  setsWon,
  score,
  serving,
  serverPlayer,
  timeoutsLeft,
  timeoutsPerSet,
  showServer,
  winner,
  borderLeft,
}: {
  name: string;
  setsWon: number;
  score: number;
  serving: boolean;
  serverPlayer: number | null;
  timeoutsLeft: number;
  timeoutsPerSet: number;
  showServer: boolean;
  winner: boolean;
  borderLeft?: boolean;
}) {
  return (
    <section
      className={`flex flex-col items-center justify-center gap-4 px-4 py-8 ${
        borderLeft ? "border-l border-border" : ""
      } ${winner ? "bg-primary/10" : ""}`}
    >
      <div className="flex items-center gap-3">
        <h2 className="max-w-[14ch] truncate text-center text-[clamp(1.2rem,4vw,3rem)] font-bold">
          {name}
        </h2>
        {winner ? <span className="text-[clamp(1rem,3vw,2rem)]">🏆</span> : null}
      </div>

      <div className="flex items-center gap-2 text-[clamp(1rem,3vw,2.2rem)] text-score-dim">
        <span className="font-mono tabular-nums">{setsWon}</span>
        <span className="text-[0.5em] uppercase tracking-widest">sets</span>
        {serving ? (
          <span className="text-primary" aria-label="serving">
            ●
          </span>
        ) : null}
      </div>

      <div
        className="font-mono font-bold leading-none tabular-nums text-score-active"
        style={{ fontSize: "clamp(5rem, 20vw, 18rem)" }}
      >
        {score}
      </div>

      {/* Beach tracks a 1/2 server number; rotation disciplines don't, so only
          show the player line when we actually have one (spec/14 §F7). */}
      {showServer && serving && serverPlayer != null ? (
        <div className="text-[clamp(0.8rem,2vw,1.2rem)] text-primary">
          Serving: Player {serverPlayer}
        </div>
      ) : null}

      {/* Timeouts remaining */}
      <div className="flex items-center gap-2 text-score-dim">
        <span className="text-[clamp(0.6rem,1.4vw,0.9rem)] uppercase tracking-wide">
          TO
        </span>
        <span className="flex gap-1">
          {Array.from({ length: timeoutsPerSet }).map((_, i) => (
            <span
              key={i}
              className={`inline-block h-3 w-3 rounded-full ${
                i < timeoutsLeft ? "bg-foreground" : "border border-border"
              }`}
            />
          ))}
        </span>
      </div>
    </section>
  );
}

/** Ticking match clock. HH:MM:SS since start; frozen once the match ends. */
function MatchClock({
  startedAt,
  endedAt,
}: {
  startedAt: string | null;
  endedAt: string | null;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (endedAt || !startedAt) return;
    // Tick from the interval only — calling setState synchronously in an effect
    // body is disallowed (react-hooks/set-state-in-effect). First tick lands in
    // ~1s; until then the clock reads 00:00:00.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);

  if (!startedAt) return <span className="font-mono tabular-nums">00:00:00</span>;
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : (now ?? start);
  const secs = Math.max(0, Math.floor((end - start) / 1000));
  const hh = String(Math.floor(secs / 3600)).padStart(2, "0");
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span className="font-mono tabular-nums">
      {hh}:{mm}:{ss}
    </span>
  );
}
