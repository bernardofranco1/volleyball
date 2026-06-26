"use client";

import { useMemo, useState } from "react";
import {
  type PlayerLite,
  useIndoorMatch,
} from "@/lib/indoor-match-context";
import type { TeamId } from "@/engine/indoor/types";

// Shown during LINEUP_PENDING. The scorer (or, later, the team tablet) sets the
// starting six in rotation order plus an optional libero, per team.
export function IndoorLineupEntry() {
  const { state, config, rosterA, rosterB, teamAName, teamBName } =
    useIndoorMatch();
  const set = state.sets[state.currentSetNumber - 1];
  if (!set) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <h2 className="mb-1 text-center font-medium">
        Set {state.currentSetNumber} — starting lineups
      </h2>
      <p className="mb-4 text-center text-xs text-score-dim">
        Position 1 serves first. Confirm both teams to begin.
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TeamLineupForm
          team="A"
          teamName={teamAName}
          roster={rosterA}
          confirmed={set.lineupConfirmedA}
          size={config.playersPerSide}
          liberoEnabled={config.liberoEnabled}
        />
        <TeamLineupForm
          team="B"
          teamName={teamBName}
          roster={rosterB}
          confirmed={set.lineupConfirmedB}
          size={config.playersPerSide}
          liberoEnabled={config.liberoEnabled}
        />
      </div>
    </div>
  );
}

function TeamLineupForm({
  team,
  teamName,
  roster,
  confirmed,
  size,
  liberoEnabled,
}: {
  team: TeamId;
  teamName: string;
  roster: PlayerLite[];
  confirmed: boolean;
  size: number;
  liberoEnabled: boolean;
}) {
  const { state, dispatch, pending } = useIndoorMatch();
  const nonLibero = useMemo(() => roster.filter((p) => !p.isLibero), [roster]);
  const defaultLineup = useMemo(
    () => Array.from({ length: size }, (_, i) => nonLibero[i]?.id ?? ""),
    [nonLibero, size],
  );
  const [lineup, setLineup] = useState<string[]>(defaultLineup);
  const [liberoId, setLiberoId] = useState<string>(
    roster.find((p) => p.isLibero)?.id ?? "",
  );

  if (confirmed) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-3 text-center text-sm text-green-400">
        ✓ {teamName} lineup confirmed
      </div>
    );
  }

  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };
  const distinct = new Set(lineup.filter(Boolean)).size === size;
  const liberoClash = liberoId !== "" && lineup.includes(liberoId);
  const canConfirm = distinct && !liberoClash && !pending;

  const submit = () => {
    if (!canConfirm) return;
    dispatch({
      type: "LINEUP_CONFIRMED",
      team,
      setNumber: state.currentSetNumber,
      playerIds: lineup,
      liberoId: liberoEnabled && liberoId ? liberoId : null,
      secondLiberoId: null,
    });
  };

  const setPos = (idx: number, value: string) =>
    setLineup((prev) => prev.map((v, i) => (i === idx ? value : v)));

  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="mb-3 font-medium">{teamName}</h3>
      <div className="space-y-2">
        {lineup.map((pid, idx) => (
          <label key={idx} className="flex items-center gap-2 text-sm">
            <span className="w-16 text-score-dim">
              Pos {idx + 1}
              {idx === 0 ? " (serve)" : ""}
            </span>
            <select
              value={pid}
              onChange={(e) => setPos(idx, e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
            >
              <option value="">— pick player —</option>
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
            <span className="w-16 text-amber-400">Libero</span>
            <select
              value={liberoId}
              onChange={(e) => setLiberoId(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
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
      ) : liberoClash ? (
        <p className="mt-2 text-xs text-red-400">
          Libero can’t be in the starting six.
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!canConfirm}
        className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Confirm {teamName}
      </button>
    </div>
  );
}
