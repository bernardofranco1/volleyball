"use client";

import { useMemo, useState } from "react";
import {
  type PlayerLite,
  useIndoorMatch,
} from "@/lib/indoor-match-context";
import type { TeamId } from "@/engine/indoor/types";
import { CancelSetStart } from "@/components/scoring/shared/CancelSetStart";
import { courtRoster } from "@/lib/roster";

// Shown during LINEUP_PENDING (set already started, old flow) and — the paper
// flow (spec/21 flow fix) — BEFORE the set exists: pre-match (READY) and during
// set breaks, when the lineup is stashed as pendingLineups and SET_START
// applies it. The scorer (or, later, the team tablet) sets the starting six in
// rotation order plus an optional libero, per team.
export function IndoorLineupEntry() {
  const { state, config, rosterA, rosterB, teamAName, teamBName, dispatch, pending } =
    useIndoorMatch();
  const set = state.sets[state.currentSetNumber - 1];
  // Pre-set: no open set — collecting for the upcoming one.
  const preSet = !set || !!set.winner;
  const upcomingSet = set?.winner ? state.currentSetNumber + 1 : state.currentSetNumber;
  if (
    !set &&
    state.status !== "COIN_TOSS" &&
    state.status !== "READY" &&
    state.status !== "LIVE"
  )
    return null;

  const confirmedA = preSet ? !!state.pendingLineups?.A : !!set?.lineupConfirmedA;
  const confirmedB = preSet ? !!state.pendingLineups?.B : !!set?.lineupConfirmedB;

  // Unwind everything recorded for this set: each confirmed lineup + SET_START.
  const undoCount =
    1 + (set?.lineupConfirmedA ? 1 : 0) + (set?.lineupConfirmedB ? 1 : 0);

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <h2 className="mb-1 text-center font-medium">
        Set {upcomingSet} — starting lineups
      </h2>
      <p className="mb-4 text-center text-xs text-score-dim">
        {preSet
          ? "Position 1 serves first. Lineups are recorded now and applied when the set starts."
          : "Position 1 serves first. Confirm both teams to begin."}
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TeamLineupForm
          team="A"
          teamName={teamAName}
          roster={rosterA}
          confirmed={confirmedA}
          preSet={preSet}
          setNumber={upcomingSet}
          size={config.playersPerSide}
          liberoEnabled={config.liberoEnabled}
        />
        <TeamLineupForm
          team="B"
          teamName={teamBName}
          roster={rosterB}
          confirmed={confirmedB}
          preSet={preSet}
          setNumber={upcomingSet}
          size={config.playersPerSide}
          liberoEnabled={config.liberoEnabled}
        />
      </div>
      {!preSet ? (
        <CancelSetStart
          setNumber={state.currentSetNumber}
          undoCount={undoCount}
          dispatch={dispatch}
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function TeamLineupForm({
  team,
  teamName,
  roster,
  confirmed,
  preSet,
  setNumber,
  size,
  liberoEnabled,
}: {
  team: TeamId;
  teamName: string;
  roster: PlayerLite[];
  confirmed: boolean;
  preSet: boolean;
  setNumber: number;
  size: number;
  liberoEnabled: boolean;
}) {
  const { dispatch, pending } = useIndoorMatch();
  // A pre-declared lineup is re-submittable (it only overwrites the stash).
  const [editing, setEditing] = useState(false);
  // Bench officials are on the roster now (spec/29 F1) and can never be in a
  // lineup — filter them out before anything else picks a default six.
  const onCourt = useMemo(() => courtRoster(roster), [roster]);
  const nonLibero = useMemo(() => onCourt.filter((p) => !p.isLibero), [onCourt]);
  const defaultLineup = useMemo(
    () => Array.from({ length: size }, (_, i) => nonLibero[i]?.id ?? ""),
    [nonLibero, size],
  );
  const [lineup, setLineup] = useState<string[]>(defaultLineup);
  const [liberoId, setLiberoId] = useState<string>(
    roster.find((p) => p.isLibero)?.id ?? "",
  );

  if (confirmed && !(preSet && editing)) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-3 text-center text-sm text-green-400">
        ✓ {teamName} lineup {preSet ? "saved" : "confirmed"}
        {preSet ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-2 rounded border border-border px-2 py-0.5 text-[11px] text-score-dim"
          >
            Change
          </button>
        ) : null}
      </div>
    );
  }

  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.jerseyName}` : id;
  };
  const distinct = new Set(lineup.filter(Boolean)).size === size;
  const liberoClash = liberoId !== "" && lineup.includes(liberoId);
  const canConfirm = distinct && !liberoClash && !pending;

  const submit = () => {
    if (!canConfirm) return;
    dispatch({
      type: "LINEUP_CONFIRMED",
      team,
      setNumber,
      playerIds: lineup,
      liberoId: liberoEnabled && liberoId ? liberoId : null,
      secondLiberoId: null,
    });
    setEditing(false);
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
              {onCourt.map((p) => (
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
