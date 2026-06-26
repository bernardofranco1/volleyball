"use client";

import { useMemo } from "react";
import { useIndoorMatch } from "@/lib/indoor-match-context";
import { activeSet } from "@/engine/indoor/types";
import { IndoorCourt } from "@/components/court/IndoorCourt";
import { IndoorActionBar } from "@/components/scoring/IndoorActionBar";
import { IndoorLineupEntry } from "@/components/scoring/IndoorLineupEntry";
import { InterruptNotifications } from "@/components/scoring/InterruptNotifications";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";

export function IndoorScoreboard({
  competitionName,
}: {
  competitionName: string;
}) {
  const {
    matchId,
    state,
    config,
    rosterA,
    rosterB,
    teamAName,
    teamBName,
    online,
    pending,
    error,
    serveClockDeadline,
  } = useIndoorMatch();
  const set = activeSet(state);
  const rosterById = useMemo(() => {
    const m = new Map<string, (typeof rosterA)[number]>();
    for (const p of [...rosterA, ...rosterB]) m.set(p.id, p);
    return m;
  }, [rosterA, rosterB]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <div className="flex items-center justify-between text-sm text-score-dim">
        <span>{competitionName} · Indoor</span>
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

      {/* Sets won */}
      <div className="flex items-center justify-center gap-6 text-center">
        <span className="flex-1 truncate text-right text-lg font-semibold">
          {teamAName}
        </span>
        <span className="font-mono text-2xl tabular-nums text-score-dim">
          {state.setsWonA}–{state.setsWonB}
        </span>
        <span className="flex-1 truncate text-left text-lg font-semibold">
          {teamBName}
        </span>
      </div>

      {/* Big score */}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface-raised">
        <BigScore value={set?.scoreA ?? 0} serving={set?.currentServer === "A"} />
        <BigScore value={set?.scoreB ?? 0} serving={set?.currentServer === "B"} borderLeft />
      </div>
      <div className="text-center text-xs uppercase tracking-wide text-score-dim">
        {set ? `Set ${set.setNumber}` : "Match not started"}
      </div>

      {/* Lineup entry gates the rally controls */}
      {state.rallyPhase === "LINEUP_PENDING" ? <IndoorLineupEntry /> : null}

      {/* Court (only meaningful once a lineup exists) */}
      {set && set.courtPositionsA.length > 0 ? (
        <IndoorCourt
          courtPositionsA={set.courtPositionsA}
          courtPositionsB={set.courtPositionsB}
          currentServer={set.currentServer}
          teamASide={set.teamASide}
          teamAName={teamAName}
          teamBName={teamBName}
          rosterById={rosterById}
          liberoIdA={set.libero.liberoOnCourtA ? set.libero.liberoIdA : null}
          liberoIdB={set.libero.liberoOnCourtB ? set.libero.liberoIdB : null}
        />
      ) : null}

      {config.serveClockEnabled ? (
        <ServeClockWidget deadline={serveClockDeadline} totalSecs={config.serveClockSecs} />
      ) : null}

      <IndoorActionBar />

      <InterruptNotifications
        matchId={matchId}
        teamAName={teamAName}
        teamBName={teamBName}
      />

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
    <div className={`relative grid place-items-center py-10 ${borderLeft ? "border-l border-border" : ""}`}>
      {serving ? (
        <span className="absolute left-1/2 top-3 -translate-x-1/2 text-xs text-primary" aria-label="serving">
          ● serving
        </span>
      ) : null}
      <span className="font-mono text-7xl font-bold tabular-nums text-score-active">
        {value}
      </span>
    </div>
  );
}
