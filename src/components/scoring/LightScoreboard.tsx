"use client";

import { useMemo } from "react";
import { useLightMatch } from "@/lib/light-match-context";
import { activeSet } from "@/engine/light/types";
import { LightCourt } from "@/components/court/LightCourt";
import { LightActionBar } from "@/components/scoring/LightActionBar";
import { LightLineupEntry } from "@/components/scoring/LightLineupEntry";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";

export function LightScoreboard({ competitionName }: { competitionName: string }) {
  const {
    state,
    config,
    rosterA,
    rosterB,
    teamAName,
    teamBName,
    teamAColor,
    teamBColor,
    online,
    pending,
    error,
    serveClockDeadline,
  } = useLightMatch();
  const set = activeSet(state);
  const rosterById = useMemo(() => {
    const m = new Map<string, (typeof rosterA)[number]>();
    for (const p of [...rosterA, ...rosterB]) m.set(p.id, p);
    return m;
  }, [rosterA, rosterB]);

  const statusLabel =
    state.status === "FINISHED" ? "Final" : set ? `Set ${set.setNumber}` : "Match not started";

  let main;
  if (state.rallyPhase === "LINEUP_PENDING") {
    main = <LightLineupEntry />;
  } else if (set && set.courtPositionsA.length > 0) {
    main = (
      <LightCourt
        courtPositionsA={set.courtPositionsA}
        courtPositionsB={set.courtPositionsB}
        currentServer={set.currentServer}
        lastRotA={set.lastRotA}
        lastRotB={set.lastRotB}
        teamASide={set.teamASide}
        teamAName={teamAName}
        teamBName={teamBName}
        teamAColor={teamAColor}
        teamBColor={teamBColor}
        rosterById={rosterById}
      />
    );
  } else {
    main = <p className="text-center text-sm text-score-dim">Set up the match to begin.</p>;
  }

  return (
    <ScoringShell
      competitionLabel={`${competitionName} · Light ${config.playersPerSide}v${config.playersPerSide}`}
      online={online}
      pending={pending}
      error={error}
      score={
        <ScoreStrip
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
          setsWonA={state.setsWonA}
          setsWonB={state.setsWonB}
          scoreA={set?.scoreA ?? 0}
          scoreB={set?.scoreB ?? 0}
          serving={set?.currentServer ?? null}
          statusLabel={statusLabel}
          sets={state.sets.map((s) => ({
            setNumber: s.setNumber,
            scoreA: s.scoreA,
            scoreB: s.scoreB,
            winner: s.winner,
          }))}
        />
      }
      main={main}
      actions={
        <div className="flex flex-col gap-2">
          {config.serveClockEnabled ? (
            <ServeClockWidget deadline={serveClockDeadline} totalSecs={config.serveClockSecs} />
          ) : null}
          <LightActionBar />
        </div>
      }
    />
  );
}
