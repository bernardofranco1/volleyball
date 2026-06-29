"use client";

import { useEffect, useState } from "react";
import { useGrassMatch } from "@/lib/grass-match-context";
import {
  type TeamId,
  activeSet,
  oppositeSide,
  oppositeTeam,
} from "@/engine/grass/types";

type Armed = "A" | "B" | "UNDO" | null;
const ARM_MS = 3000;

export function GrassActionBar() {
  const { state, config, dispatch, pending, teamAName, teamBName } =
    useGrassMatch();
  const [armed, setArmed] = useState<Armed>(null);
  const [subTeam, setSubTeam] = useState<TeamId | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const set = activeSet(state);
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);

  if (state.status === "FINISHED")
    return (
      <Banner>
        🏆 {name(state.winner ?? "A")} wins {state.setsWonA}–{state.setsWonB}
      </Banner>
    );

  if (state.rallyPhase === "SET_BREAK")
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span>
            Set {set?.setNumber} ended — {state.setsWonA}–{state.setsWonB}
          </span>
          <Primary
            onClick={() => {
              const prev = activeSet(state);
              if (!prev) return;
              dispatch({
                type: "SET_START",
                setNumber: state.currentSetNumber + 1,
                firstServer: oppositeTeam(prev.firstServer),
                teamAStartSide: oppositeSide(prev.teamAStartSide),
              });
            }}
          >
            Start next set
          </Primary>
        </div>
      </Banner>
    );

  if (state.rallyPhase === "TIMEOUT_ACTIVE")
    return (
      <Banner>
        <Primary
          onClick={() =>
            dispatch({ type: "TIMEOUT_END", team: state.activeTimeoutTeam ?? "A" })
          }
        >
          End time-out ({name(state.activeTimeoutTeam ?? "A")})
        </Primary>
      </Banner>
    );

  if (state.rallyPhase === "MEDICAL_TIMEOUT_ACTIVE")
    return (
      <Banner>
        <Primary onClick={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })}>
          End medical time-out
        </Primary>
      </Banner>
    );

  if (state.rallyPhase === "LINEUP_PENDING")
    return (
      <Banner>
        <span className="text-sm text-score-dim">
          Confirm both lineups above to begin.
        </span>
      </Banner>
    );

  if (state.status === "SETUP")
    return (
      <Banner>
        <Primary onClick={() => dispatch({ type: "MATCH_CREATED", matchId: state.matchId })}>
          Set up match
        </Primary>
      </Banner>
    );

  if (state.status === "COIN_TOSS")
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span className="text-sm text-score-dim">Coin toss — who serves first?</span>
          <div className="flex gap-3">
            <Primary onClick={() => dispatch({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" })}>
              {teamAName} serves
            </Primary>
            <Primary onClick={() => dispatch({ type: "COIN_TOSS", firstServer: "B", teamAStartSide: "LEFT" })}>
              {teamBName} serves
            </Primary>
          </div>
        </div>
      </Banner>
    );

  if (state.status === "READY")
    return (
      <Banner>
        <Primary onClick={() => dispatch({ type: "MATCH_START" })}>Start match</Primary>
      </Banner>
    );

  if (!set || set.winner)
    return (
      <Banner>
        <Primary
          onClick={() =>
            dispatch({
              type: "SET_START",
              setNumber: state.currentSetNumber,
              firstServer: state.set1FirstServer ?? "A",
              teamAStartSide: "LEFT",
            })
          }
        >
          Start set {state.currentSetNumber}
        </Primary>
      </Banner>
    );

  // ── live scoring ──────────────────────────────────────────────────────────
  const tap = (team: TeamId) => {
    if (armed === team) {
      dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" });
      setArmed(null);
    } else setArmed(team);
  };
  const tapUndo = () => {
    if (armed === "UNDO") {
      dispatch({ type: "UNDO", targetEventId: "" });
      setArmed(null);
    } else setArmed("UNDO");
  };
  const toFull = (t: TeamId) =>
    (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB) >= config.timeoutsPerSet;

  return (
    <div className="flex flex-col gap-3">
      {/* Buttons follow court side so they track switches (brief §4.1). */}
      <div className="grid grid-cols-2 gap-3">
        {(set?.teamASide === "RIGHT"
          ? (["B", "A"] as const)
          : (["A", "B"] as const)
        ).map((t) => (
          <Score key={t} armed={armed === t} onClick={() => tap(t)}>
            {armed === t
              ? `Confirm — ${t === "A" ? teamAName : teamBName}`
              : `Point ${t === "A" ? teamAName : teamBName}`}
          </Score>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((t) => (
          <div key={t} className="flex flex-wrap items-center justify-center gap-1.5">
            <Secondary disabled={toFull(t)} onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: t })}>
              T/O ({config.timeoutsPerSet - (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB)})
            </Secondary>
            <Secondary onClick={() => setSubTeam(subTeam === t ? null : t)}>Sub</Secondary>
          </div>
        ))}
      </div>

      {subTeam ? <SubPanel team={subTeam} onClose={() => setSubTeam(null)} /> : null}

      <div className="flex items-center justify-center gap-2">
        <Secondary armed={armed === "UNDO"} onClick={tapUndo} disabled={pending}>
          {armed === "UNDO" ? "Confirm undo" : "Undo"}
        </Secondary>
        <Secondary
          onClick={() => {
            const text = window.prompt("Note");
            if (text) dispatch({ type: "NOTE", text });
          }}
        >
          Note
        </Secondary>
      </div>
    </div>
  );
}

function SubPanel({ team, onClose }: { team: TeamId; onClose: () => void }) {
  const { state, dispatch, rosterA, rosterB } = useGrassMatch();
  const set = activeSet(state)!;
  const roster = team === "A" ? rosterA : rosterB;
  const court = team === "A" ? set.courtPositionsA : set.courtPositionsB;
  const bench = roster.filter((p) => !court.includes(p.id));
  const [outId, setOutId] = useState(court[0] ?? "");
  const [inId, setInId] = useState(bench[0]?.id ?? "");
  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          Substitution — {team} (used {team === "A" ? set.subsUsedA : set.subsUsedB})
        </span>
        <button type="button" onClick={onClose} className="text-xs text-score-dim hover:text-foreground">
          Close
        </button>
      </div>
      <div className="space-y-2">
        <Row label="Out" value={outId} onChange={setOutId} options={court} label2={label} />
        <Row label="In" value={inId} onChange={setInId} options={bench.map((b) => b.id)} label2={label} />
        <button
          type="button"
          disabled={!outId || !inId}
          onClick={() => {
            dispatch({ type: "SUBSTITUTION", team, outPlayerId: outId, inPlayerId: inId });
            onClose();
          }}
          className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Confirm sub
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, onChange, options, label2 }: { label: string; value: string; onChange: (v: string) => void; options: string[]; label2: (id: string) => string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-10 text-score-dim">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5">
        {options.length === 0 ? <option value="">— none —</option> : null}
        {options.map((id) => (
          <option key={id} value={id}>
            {label2(id)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-24 place-items-center rounded-xl border border-border bg-surface-raised p-4 text-center text-lg font-medium">
      {children}
    </div>
  );
}
function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50">
      {children}
    </button>
  );
}
function Score({ children, onClick, armed }: { children: React.ReactNode; onClick: () => void; armed: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-xl px-4 py-6 text-lg font-semibold transition-all ${armed ? "animate-pulse bg-primary text-primary-fg ring-2 ring-primary" : "border border-border bg-surface-raised hover:border-primary"}`}>
      {children}
    </button>
  );
}
function Secondary({ children, onClick, disabled, armed }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; armed?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${armed ? "border-red-500 bg-red-500/10 text-red-300" : "border-border text-score-dim hover:text-foreground"}`}>
      {children}
    </button>
  );
}
