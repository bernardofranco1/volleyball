"use client";

import { useEffect, useState } from "react";
import { useIndoorMatch } from "@/lib/indoor-match-context";
import { resolveTeamColor, readableTextOn } from "@/lib/colors";
import {
  type IndoorSetState,
  type TeamId,
  activeSet,
  oppositeSide,
  oppositeTeam,
} from "@/engine/indoor/types";

type Armed = "A" | "B" | "UNDO" | null;
const ARM_MS = 3000;

export function IndoorActionBar() {
  const { state, config, dispatch, pending, teamAName, teamBName, teamAColor, teamBColor } =
    useIndoorMatch();
  const [armed, setArmed] = useState<Armed>(null);
  const [subTeam, setSubTeam] = useState<TeamId | null>(null);
  const [liberoTeam, setLiberoTeam] = useState<TeamId | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const set = activeSet(state);
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);

  // ── terminal / interstitial phases ────────────────────────────────────────
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

  if (state.rallyPhase === "VCS_ACTIVE" && set) {
    const team = set.vcs.activeChallenge?.team ?? "A";
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span className="text-sm text-score-dim">
            Video challenge — {name(team)}
          </span>
          <div className="flex gap-3">
            <Primary onClick={() => dispatch({ type: "VCS_RESULT", upheld: true, team })}>
              Upheld (keep)
            </Primary>
            <Secondary onClick={() => dispatch({ type: "VCS_RESULT", upheld: false, team })}>
              Rejected (lose)
            </Secondary>
          </div>
        </div>
      </Banner>
    );
  }

  if (state.rallyPhase === "LINEUP_PENDING")
    return (
      <Banner>
        <span className="text-sm text-score-dim">
          Waiting for both lineups (see above).
        </span>
      </Banner>
    );

  // ── pre-match setup ───────────────────────────────────────────────────────
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
      {/* Point buttons follow court side; Undo + Note stack between them. */}
      {(() => {
        const order =
          set?.teamASide === "RIGHT" ? (["B", "A"] as const) : (["A", "B"] as const);
        const scoreBtn = (t: TeamId) => (
          <Score
            armed={armed === t}
            color={resolveTeamColor(t === "A" ? teamAColor : teamBColor, t)}
            onClick={() => tap(t)}
          >
            {armed === t
              ? `Confirm — ${t === "A" ? teamAName : teamBName}`
              : `Point ${t === "A" ? teamAName : teamBName}`}
          </Score>
        );
        return (
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
            {scoreBtn(order[0])}
            <div className="flex flex-col justify-center gap-1.5">
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
            {scoreBtn(order[1])}
          </div>
        );
      })()}

      {/* Per-team officiating row */}
      <div className="grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((t) => (
          <div key={t} className="flex flex-wrap items-center justify-center gap-1.5">
            <Secondary disabled={toFull(t)} onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: t })}>
              T/O ({config.timeoutsPerSet - (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB)})
            </Secondary>
            <Secondary onClick={() => setSubTeam(subTeam === t ? null : t)}>Sub</Secondary>
            {config.liberoEnabled ? (
              <Secondary onClick={() => setLiberoTeam(liberoTeam === t ? null : t)}>
                Libero
              </Secondary>
            ) : null}
            {/* Challenge (VCS) hidden — brief §6 (engine kept dormant). */}
          </div>
        ))}
      </div>

      {subTeam ? (
        <SubPanel team={subTeam} onClose={() => setSubTeam(null)} />
      ) : null}
      {liberoTeam ? (
        <LiberoPanel team={liberoTeam} onClose={() => setLiberoTeam(null)} />
      ) : null}
    </div>
  );
}

// ── substitution panel ────────────────────────────────────────────────────────

function SubPanel({ team, onClose }: { team: TeamId; onClose: () => void }) {
  const { state, dispatch, rosterA, rosterB } = useIndoorMatch();
  const set = activeSet(state)!;
  const roster = team === "A" ? rosterA : rosterB;
  const court = team === "A" ? set.courtPositionsA : set.courtPositionsB;
  const liberoIds = liberoIdsOf(set, team);
  const onCourt = court.filter((id) => !liberoIds.includes(id));
  const bench = roster.filter(
    (p) => !court.includes(p.id) && !liberoIds.includes(p.id),
  );
  const [outId, setOutId] = useState(onCourt[0] ?? "");
  const [inId, setInId] = useState(bench[0]?.id ?? "");
  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };

  return (
    <Panel title={`Substitution — ${team === "A" ? "A" : "B"} (used ${team === "A" ? set.subsUsedA : set.subsUsedB})`} onClose={onClose}>
      <SelectRow label="Out" value={outId} onChange={setOutId} options={onCourt} label2={label} />
      <SelectRow label="In" value={inId} onChange={setInId} options={bench.map((b) => b.id)} label2={label} />
      <PanelConfirm
        disabled={!outId || !inId}
        onClick={() => {
          dispatch({ type: "SUBSTITUTION", team, outPlayerId: outId, inPlayerId: inId });
          onClose();
        }}
      >
        Confirm sub
      </PanelConfirm>
    </Panel>
  );
}

// ── libero panel ────────────────────────────────────────────────────────────

function LiberoPanel({ team, onClose }: { team: TeamId; onClose: () => void }) {
  const { state, dispatch } = useIndoorMatch();
  const set = activeSet(state)!;
  const onCourt = team === "A" ? set.libero.liberoOnCourtA : set.libero.liberoOnCourtB;
  const liberoId = team === "A" ? set.libero.liberoIdA : set.libero.liberoIdB;
  const replacing = team === "A" ? set.libero.liberoReplacingA : set.libero.liberoReplacingB;
  const court = team === "A" ? set.courtPositionsA : set.courtPositionsB;
  // Back-row positions are 1,5,6 → indices 0,4,5 (but pos 1 serves; libero usually 5/6).
  const backRow = [5, 6].map((p) => court[p - 1]).filter(Boolean);
  const [outId, setOutId] = useState(backRow[0] ?? "");

  if (!liberoId)
    return (
      <Panel title="Libero" onClose={onClose}>
        <p className="text-sm text-score-dim">No libero designated for this team.</p>
      </Panel>
    );

  return (
    <Panel title={`Libero — ${team}`} onClose={onClose}>
      {onCourt ? (
        <PanelConfirm
          onClick={() => {
            dispatch({
              type: "LIBERO_REPLACEMENT",
              team,
              liberoId,
              direction: "OUT",
              outPlayerId: replacing ?? "",
            });
            onClose();
          }}
        >
          Libero out → return {replacing ?? "player"}
        </PanelConfirm>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="w-16 text-score-dim">Replace</span>
            <select
              value={outId}
              onChange={(e) => setOutId(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5"
            >
              {backRow.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <PanelConfirm
            disabled={!outId}
            onClick={() => {
              dispatch({
                type: "LIBERO_REPLACEMENT",
                team,
                liberoId,
                direction: "IN",
                outPlayerId: outId,
              });
              onClose();
            }}
          >
            Libero in
          </PanelConfirm>
        </>
      )}
    </Panel>
  );
}

function liberoIdsOf(set: IndoorSetState, team: TeamId): string[] {
  const ids =
    team === "A"
      ? [set.libero.liberoIdA, set.libero.secondLiberoIdA]
      : [set.libero.liberoIdB, set.libero.secondLiberoIdB];
  return ids.filter((x): x is string => Boolean(x));
}

// ── presentational atoms ──────────────────────────────────────────────────────

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
function Score({ children, onClick, armed, color }: { children: React.ReactNode; onClick: () => void; armed: boolean; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: color, color: readableTextOn(color) }}
      className={`rounded-xl px-4 py-4 text-base font-semibold transition-all ${armed ? "animate-pulse ring-4 ring-white/80" : "ring-1 ring-black/10 hover:brightness-110"}`}
    >
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
function Panel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <button type="button" onClick={onClose} className="text-xs text-score-dim hover:text-foreground">
          Close
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function SelectRow({ label, value, onChange, options, label2 }: { label: string; value: string; onChange: (v: string) => void; options: string[]; label2: (id: string) => string }) {
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
function PanelConfirm({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40">
      {children}
    </button>
  );
}
