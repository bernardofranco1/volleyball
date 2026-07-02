"use client";

// Lineup entry shared by grass & light: both confirm the two teams' rotation
// orders in a single LINEUP_CONFIRMED event (position 1 serves first).
import { useMemo, useState } from "react";
import type { PlayerLite } from "@/lib/match-provider";
import { CancelSetStart } from "@/components/scoring/shared/CancelSetStart";

export type LineupDispatch = (
  payload:
    | {
        type: "LINEUP_CONFIRMED";
        setNumber: number;
        teamAPlayerIds: string[];
        teamBPlayerIds: string[];
      }
    | { type: "UNDO"; targetEventId: string },
) => void;

export function RotationLineupEntry({
  currentSetNumber,
  playersPerSide: n,
  rosterA,
  rosterB,
  teamAName,
  teamBName,
  dispatch,
  pending,
}: {
  currentSetNumber: number;
  playersPerSide: number;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  teamAName: string;
  teamBName: string;
  dispatch: LineupDispatch;
  pending: boolean;
}) {
  const defA = useMemo(
    () => Array.from({ length: n }, (_, i) => rosterA[i]?.id ?? ""),
    [rosterA, n],
  );
  const defB = useMemo(
    () => Array.from({ length: n }, (_, i) => rosterB[i]?.id ?? ""),
    [rosterB, n],
  );
  const [lineupA, setLineupA] = useState<string[]>(defA);
  const [lineupB, setLineupB] = useState<string[]>(defB);

  const distinct = (l: string[]) =>
    new Set(l.filter(Boolean)).size === n && l.every(Boolean);
  const canConfirm = distinct(lineupA) && distinct(lineupB) && !pending;

  const confirm = () => {
    if (!canConfirm) return;
    dispatch({
      type: "LINEUP_CONFIRMED",
      setNumber: currentSetNumber,
      teamAPlayerIds: lineupA,
      teamBPlayerIds: lineupB,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <h2 className="mb-1 text-center font-medium">
        Set {currentSetNumber} — lineups ({n} players)
      </h2>
      <p className="mb-4 text-center text-xs text-score-dim">
        Position 1 serves first.
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TeamColumn
          teamName={teamAName}
          roster={rosterA}
          lineup={lineupA}
          setLineup={setLineupA}
          n={n}
        />
        <TeamColumn
          teamName={teamBName}
          roster={rosterB}
          lineup={lineupB}
          setLineup={setLineupB}
          n={n}
        />
      </div>
      <button
        type="button"
        onClick={confirm}
        disabled={!canConfirm}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Confirm lineups &amp; start
      </button>
      {/* Grass/light confirm both teams in ONE event, so during lineup entry
          only the SET_START itself needs unwinding. */}
      <CancelSetStart
        setNumber={currentSetNumber}
        undoCount={1}
        dispatch={dispatch}
        pending={pending}
      />
    </div>
  );
}

function TeamColumn({
  teamName,
  roster,
  lineup,
  setLineup,
  n,
}: {
  teamName: string;
  roster: PlayerLite[];
  lineup: string[];
  setLineup: (fn: (prev: string[]) => string[]) => void;
  n: number;
}) {
  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };
  const distinct = new Set(lineup.filter(Boolean)).size === n && lineup.every(Boolean);
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
              onChange={(e) =>
                setLineup((prev) =>
                  prev.map((v, i) => (i === idx ? e.target.value : v)),
                )
              }
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
            >
              <option value="">— pick —</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.id)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!distinct ? (
        <p className="mt-2 text-xs text-red-400">Pick {n} distinct players.</p>
      ) : null}
    </div>
  );
}
