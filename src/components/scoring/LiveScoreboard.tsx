"use client";

import { useMatch } from "@/lib/match-context";
import { activeSet } from "@/engine/beach/types";
import { BeachCourt } from "@/components/court/BeachCourt";
import { BeachActionBar } from "@/components/scoring/BeachActionBar";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";

export function LiveScoreboard({
  competitionName,
  teamAName,
  teamBName,
}: {
  competitionName: string;
  teamAName: string;
  teamBName: string;
}) {
  const { state, config, online, error, pending, serveClockDeadline } =
    useMatch();
  const set = activeSet(state);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      {/* TopBar */}
      <div className="flex items-center justify-between text-sm text-score-dim">
        <span>{competitionName}</span>
        <span className="flex items-center gap-2">
          {pending ? <span aria-hidden>⟳</span> : null}
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              online ? "bg-green-500" : "bg-amber-500"
            }`}
            title={online ? "Online" : "Offline — changes queued"}
          />
        </span>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {/* ScoreHeader: sets won */}
      <div className="flex items-center justify-center gap-6 text-center">
        <TeamName name={teamAName} align="right" />
        <div className="font-mono text-2xl tabular-nums text-score-dim">
          {state.setsWonA}–{state.setsWonB}
        </div>
        <TeamName name={teamBName} align="left" />
      </div>

      {/* BigScore */}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface-raised">
        <BigScore value={set?.scoreA ?? 0} serving={set?.currentServer === "A"} />
        <BigScore
          value={set?.scoreB ?? 0}
          serving={set?.currentServer === "B"}
          borderLeft
        />
      </div>
      <div className="text-center text-xs uppercase tracking-wide text-score-dim">
        {set ? `Set ${set.setNumber}` : "Match not started"}
        {set?.ttoFired ? " · TTO done" : ""}
      </div>

      {/* Court */}
      <BeachCourt
        teamASide={set?.teamASide ?? "LEFT"}
        currentServer={set?.currentServer ?? null}
        teamAName={teamAName}
        teamBName={teamBName}
      />

      {/* Serve clock */}
      {config.serveClockEnabled ? (
        <ServeClockWidget
          deadline={serveClockDeadline}
          totalSecs={config.serveClockSecs}
        />
      ) : null}

      {/* Action bar */}
      <BeachActionBar teamAName={teamAName} teamBName={teamBName} />

      {/* Set summary */}
      {state.sets.length > 0 ? (
        <div className="rounded-xl border border-border">
          <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-score-dim">
            Sets
          </div>
          <ul className="divide-y divide-border text-sm">
            {state.sets.map((s) => (
              <li key={s.setNumber} className="flex justify-between px-3 py-2">
                <span className="text-score-dim">Set {s.setNumber}</span>
                <span className="font-mono tabular-nums">
                  {s.scoreA}–{s.scoreB}
                  {s.winner ? ` (${s.winner === "A" ? teamAName : teamBName})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TeamName({ name, align }: { name: string; align: "left" | "right" }) {
  return (
    <span
      className={`flex-1 truncate text-lg font-semibold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {name}
    </span>
  );
}

function BigScore({
  value,
  serving,
  borderLeft,
}: {
  value: number;
  serving: boolean;
  borderLeft?: boolean;
}) {
  return (
    <div
      className={`relative grid place-items-center py-10 ${
        borderLeft ? "border-l border-border" : ""
      }`}
    >
      {serving ? (
        <span
          className="absolute left-1/2 top-3 -translate-x-1/2 text-xs text-primary"
          aria-label="serving"
        >
          ● serving
        </span>
      ) : null}
      <span className="font-mono text-7xl font-bold tabular-nums text-score-active">
        {value}
      </span>
    </div>
  );
}
