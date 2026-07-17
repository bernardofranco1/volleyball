"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { channelConfig, ensureRealtimeAuth } from "@/lib/realtime-client";
import { type BeachMatchState, activeSet } from "@/engine/beach/types";
import {
  BroadcastBoard,
  type BoardSet,
} from "@/components/scoreboard/BroadcastBoard";
import {
  IndoorBoard,
  type IndoorPlayer,
  type IndoorRosterEntry,
} from "@/components/scoreboard/IndoorBoard";
import type { BoardTheme } from "@/lib/board-theme";
import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Discipline } from "@/engine/types";
import { type TournamentConfig, timeoutCapForSet } from "@/engine/config";
import { useCountdown, formatCountdown } from "@/components/scoreboard/Countdown";
import {
  activeCountdown,
  CountdownOverlay,
} from "@/components/scoring/shared/CountdownOverlay";

// Display modes are retained for URL compatibility; the broadcast board always
// shows score + sets + serving, so they no longer change the layout.
export type DisplayMode =
  | "SCORE_ONLY"
  | "SCORE_WITH_SETS"
  | "SCORE_WITH_ROTATION";

// Court/list jerseys show the surname only (matches the redesign mock); fall back
// to the full string if there's no whitespace to split on.
const surname = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
};

export function ScoreboardDisplay({
  matchId,
  initialState,
  teamAName,
  teamBName,
  logoUrl,
  theme,
  teamAColor,
  teamBColor,
  discipline,
  rosterA,
  rosterB,
  maxSubsPerSet,
  timeoutsPerSet,
  scheduledAtMs,
  mode,
  poll,
  basePath,
  awaitingLabel,
}: {
  matchId: string;
  initialState: BeachMatchState;
  teamAName: string;
  teamBName: string;
  competitionName: string;
  tenantName: string;
  logoUrl: string | null;
  theme: BoardTheme;
  teamAColor: string | null;
  teamBColor: string | null;
  discipline: Discipline;
  rosterA?: PlayerLite[];
  rosterB?: PlayerLite[];
  maxSubsPerSet?: number;
  scheduledAtMs: number | null;
  timeoutsPerSet: number;
  mode: DisplayMode;
  poll: boolean;
  basePath: string;
  /** Shown when the result is recorded but not yet manager-confirmed. */
  awaitingLabel?: string | null;
}) {
  const [state, setState] = useState<BeachMatchState>(initialState);
  const [config, setConfig] = useState<TournamentConfig | null>(null);
  // Server-clock minus device-clock (ms). Countdown deadlines derive from
  // server event timestamps; a drifting TV clock would shift them one-for-one.
  // Only updated when drift exceeds 1s so routine fetches don't churn renders.
  const [clockOffset, setClockOffset] = useState(0);
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
      const data = (await res.json()) as {
        state: BeachMatchState;
        config?: TournamentConfig;
        serverNow?: number;
      };
      if (typeof data.serverNow === "number") {
        const off = data.serverNow - Date.now();
        setClockOffset((prev) => (Math.abs(off - prev) > 1000 ? off : prev));
      }
      if (data.config) setConfig(data.config);
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

  // Pre-match countdown to scheduled start (§4.4) + team time-out countdown (§4.3).
  const preMatchMs = useCountdown(
    scheduledAtMs && !finished && state.status !== "LIVE" ? scheduledAtMs : null,
  );
  // Time-out / set-break countdown overlay, driven by authoritative state + config
  // (deadline from the server event timestamp) — shared with the scorer + tablet.
  // The deadline is in server-clock terms; shift it into this device's clock.
  const cd = config ? activeCountdown(state, config) : null;
  const cdMs = useCountdown(cd ? cd.deadlineMs - clockOffset : null);
  const showPreMatch =
    preMatchMs > 0 && !finished && state.status !== "LIVE" && scheduledAtMs != null;

  // Beach: surname of the player expected to serve — underlined in the top
  // bar's pair name. Same rule as the scorer console: the declared service
  // order (SERVICE_ORDER) when known, roster order assumed until then.
  let servingPlayer: string | null = null;
  if (discipline === "BEACH" && set && !set.winner) {
    const team = set.currentServer;
    const slot = team === "A" ? set.serverPlayerA : set.serverPlayerB;
    const roster = (team === "A" ? rosterA : rosterB) ?? [];
    if (slot && roster.length === 2) {
      const firstId =
        team === "A" ? set.firstServerPlayerIdA : set.firstServerPlayerIdB;
      const first = firstId
        ? roster.find((p) => p.id === firstId)
        : roster[0];
      const second = roster.find((p) => p.id !== first?.id);
      const player = first && second ? [first, second][slot - 1] : undefined;
      if (player) servingPlayer = surname(player.fullName);
    }
  }

  const setsLadder: BoardSet[] = state.sets.map((s) => ({
    setNumber: s.setNumber,
    scoreA: s.scoreA,
    scoreB: s.scoreB,
    winner: s.winner,
  }));

  // Indoor reads extra fields off the current set (cast — same runtime object).
  const iset = set as unknown as
    | {
        courtPositionsA?: string[];
        courtPositionsB?: string[];
        currentServer?: "A" | "B";
        timeoutsUsedA?: number;
        timeoutsUsedB?: number;
        subsUsedA?: number;
        subsUsedB?: number;
      }
    | undefined;
  const rosterMap = new Map<string, PlayerLite>();
  for (const p of rosterA ?? []) rosterMap.set(p.id, p);
  for (const p of rosterB ?? []) rosterMap.set(p.id, p);
  const rotation = (
    ids: string[] | undefined,
    team: "A" | "B",
  ): IndoorPlayer[] =>
    (ids ?? []).map((id, i) => {
      const p = rosterMap.get(id);
      return {
        pos: i + 1,
        jersey: p?.jerseyNumber ?? null,
        name: p ? surname(p.fullName) : "—",
        serving: iset?.currentServer === team && i === 0,
        libero: p?.isLibero ?? false,
        key: id,
      };
    });

  // No-rotation fallback (lineup not submitted): plain roster lists.
  const rosterList = (players: PlayerLite[] | undefined): IndoorRosterEntry[] =>
    (players ?? []).map((p) => ({
      jersey: p.jerseyNumber,
      name: surname(p.fullName),
      libero: p.isLibero,
    }));

  return (
    <>
      {awaitingLabel ? (
        <div className="fixed left-1/2 top-2 z-[60] -translate-x-1/2 rounded-full border border-amber-400/60 bg-amber-500/20 px-4 py-1 text-sm font-medium text-amber-200 backdrop-blur">
          {awaitingLabel}
        </div>
      ) : null}
      {discipline === "INDOOR" ? (
        <IndoorBoard
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
          scoreA={set?.scoreA ?? 0}
          scoreB={set?.scoreB ?? 0}
          setsWonA={state.setsWonA}
          setsWonB={state.setsWonB}
          sets={setsLadder}
          setNumber={set?.setNumber ?? null}
          finished={finished}
          rotationA={rotation(iset?.courtPositionsA, "A")}
          rotationB={rotation(iset?.courtPositionsB, "B")}
          rosterA={rosterList(rosterA)}
          rosterB={rosterList(rosterB)}
          timeoutsUsedA={iset?.timeoutsUsedA ?? 0}
          timeoutsUsedB={iset?.timeoutsUsedB ?? 0}
          // Tie-break-aware cap: the deciding set may allow fewer time-outs.
          timeoutsPerSet={
            config
              ? timeoutCapForSet(config, state.currentSetNumber)
              : timeoutsPerSet
          }
          subsUsedA={iset?.subsUsedA ?? 0}
          subsUsedB={iset?.subsUsedB ?? 0}
          maxSubsPerSet={maxSubsPerSet ?? 6}
          theme={theme}
        />
      ) : (
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
          servingPlayer={servingPlayer}
          setNumber={set?.setNumber ?? null}
          sets={setsLadder}
          logoUrl={logoUrl}
          finished={finished}
          theme={theme}
        />
      )}

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

      {cd && cdMs > 0 ? (
        <CountdownOverlay
          title={
            cd.kind === "TIMEOUT"
              ? `${cd.team === "A" ? teamAName : teamBName} · Time-out`
              : "Set break"
          }
          ms={cdMs}
        />
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
