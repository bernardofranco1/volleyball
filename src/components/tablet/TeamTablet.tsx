"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PlayerLite } from "@/lib/indoor-match-context";
import type { IndoorMatchState, TeamId } from "@/engine/indoor/types";

interface InterruptRow {
  id: string;
  requestType: string;
  status: string;
}

const REQUESTS = [
  { type: "TIMEOUT", label: "Time-out" },
  { type: "SUBSTITUTION", label: "Substitution" },
  { type: "CHALLENGE", label: "Challenge" },
  { type: "MEDICAL", label: "Medical" },
] as const;

export function TeamTablet({
  matchId,
  team,
  token,
  initialState,
  roster,
  teamName,
  lineupRequired,
  liberoEnabled,
  playersPerSide,
}: {
  matchId: string;
  team: TeamId;
  token: string;
  initialState: IndoorMatchState;
  roster: PlayerLite[];
  teamName: string;
  lineupRequired: boolean;
  liberoEnabled: boolean;
  playersPerSide: number;
}) {
  const [state, setState] = useState<IndoorMatchState>(initialState);
  const [requests, setRequests] = useState<InterruptRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Authoritative read-only state from /state (realtime only signals — §B1).
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/state`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { state: IndoorMatchState };
      if (data.state.lastSequence >= stateRef.current.lastSequence)
        setState(data.state);
    } catch {
      /* keep last good state */
    }
  }, [matchId]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "broadcast",
        { event: "state-update" },
        (m: { payload?: { lastSequence?: number } }) => {
          const seq = m.payload?.lastSequence;
          if (typeof seq === "number" && seq > stateRef.current.lastSequence)
            void fetchState();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, fetchState]);

  // Poll our own interrupt requests for the scorer's resolution.
  const pollRequests = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/matches/${matchId}/interrupt-requests?token=${encodeURIComponent(token)}&team=${team}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = (await res.json()) as { requests: InterruptRow[] };
        setRequests(data.requests);
      }
    } catch {
      /* keep last */
    }
  }, [matchId, team, token]);

  useEffect(() => {
    // First poll via a 0ms timer (not synchronously) so the effect body doesn't
    // call setState directly (react-hooks/set-state-in-effect).
    const first = setTimeout(pollRequests, 0);
    const id = setInterval(pollRequests, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [pollRequests]);

  const sendRequest = async (requestType: string) => {
    setMsg(null);
    const res = await fetch(`/api/matches/${matchId}/interrupt-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, team, requestType }),
    });
    if (res.ok) {
      setMsg(`${requestType} request sent`);
      void pollRequests();
    } else {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(e.error ?? "Request failed");
    }
  };

  const set = state.sets[state.currentSetNumber - 1];
  const ownConfirmed = set
    ? team === "A"
      ? set.lineupConfirmedA
      : set.lineupConfirmedB
    : false;
  const needLineup =
    lineupRequired && state.rallyPhase === "LINEUP_PENDING" && !ownConfirmed;
  const score = set ? `${set.scoreA}–${set.scoreB}` : "0–0";

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-auto bg-surface p-5 text-foreground">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-score-dim">
            Team {team} tablet
          </div>
          <h1 className="text-2xl font-bold">{teamName}</h1>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl tabular-nums">{score}</div>
          <div className="text-xs text-score-dim">
            {state.status === "FINISHED"
              ? "Final"
              : set
                ? `Set ${set.setNumber} · ${state.setsWonA}–${state.setsWonB}`
                : "Not started"}
          </div>
        </div>
      </header>

      {needLineup ? (
        <LineupForm
          matchId={matchId}
          team={team}
          token={token}
          roster={roster}
          setNumber={state.currentSetNumber}
          size={playersPerSide}
          liberoEnabled={liberoEnabled}
          onResult={setMsg}
        />
      ) : (
        <section className="rounded-xl border border-border bg-surface-raised p-4">
          <h2 className="mb-3 font-medium">Request the scorer</h2>
          <div className="grid grid-cols-2 gap-3">
            {REQUESTS.map((r) => (
              <button
                key={r.type}
                type="button"
                onClick={() => sendRequest(r.type)}
                className="rounded-xl border border-border bg-surface px-4 py-5 text-base font-semibold transition-colors hover:border-primary"
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {msg ? <p className="mt-3 text-sm text-score-dim">{msg}</p> : null}

      {requests.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-score-dim">
            Recent requests
          </h3>
          <ul className="space-y-1">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>{r.requestType}</span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "APPROVED"
      ? "border-green-500/50 text-green-400"
      : status === "DENIED"
        ? "border-red-500/50 text-red-400"
        : "border-amber-500/50 text-amber-400";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function LineupForm({
  matchId,
  team,
  token,
  roster,
  setNumber,
  size,
  liberoEnabled,
  onResult,
}: {
  matchId: string;
  team: TeamId;
  token: string;
  roster: PlayerLite[];
  setNumber: number;
  size: number;
  liberoEnabled: boolean;
  onResult: (msg: string) => void;
}) {
  const nonLibero = useMemo(() => roster.filter((p) => !p.isLibero), [roster]);
  const [lineup, setLineup] = useState<string[]>(
    Array.from({ length: size }, (_, i) => nonLibero[i]?.id ?? ""),
  );
  const [liberoId, setLiberoId] = useState(
    roster.find((p) => p.isLibero)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);

  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };
  const distinct = new Set(lineup.filter(Boolean)).size === size;
  const clash = liberoId !== "" && lineup.includes(liberoId);

  const submit = async () => {
    if (!distinct || clash) return;
    setBusy(true);
    const res = await fetch(`/api/matches/${matchId}/lineup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        team,
        setNumber,
        playerIds: lineup,
        liberoId: liberoEnabled && liberoId ? liberoId : null,
        secondLiberoId: null,
      }),
    });
    setBusy(false);
    if (res.ok) onResult("Lineup submitted ✓");
    else {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      onResult(e.error ?? "Lineup rejected");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-4">
      <h2 className="mb-1 font-medium">Set {setNumber} lineup</h2>
      <p className="mb-3 text-xs text-score-dim">
        Position 1 serves first. Pick {size} players in rotation order.
      </p>
      <div className="space-y-2">
        {lineup.map((pid, idx) => (
          <label key={idx} className="flex items-center gap-2 text-sm">
            <span className="w-20 text-score-dim">
              Pos {idx + 1}
              {idx === 0 ? " (serve)" : ""}
            </span>
            <select
              value={pid}
              onChange={(e) =>
                setLineup((prev) =>
                  prev.map((v, i) => (i === idx ? e.target.value : v)),
                )
              }
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-2"
            >
              <option value="">— pick —</option>
              {nonLibero.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.id)}
                </option>
              ))}
            </select>
          </label>
        ))}
        {liberoEnabled ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="w-20 text-amber-400">Libero</span>
            <select
              value={liberoId}
              onChange={(e) => setLiberoId(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-2"
            >
              <option value="">— none —</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.id)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {!distinct ? (
        <p className="mt-2 text-xs text-red-400">Pick {size} distinct players.</p>
      ) : clash ? (
        <p className="mt-2 text-xs text-red-400">Libero can’t be a starter.</p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!distinct || clash || busy}
        className="mt-3 w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Submitting…" : "Submit lineup"}
      </button>
    </section>
  );
}
