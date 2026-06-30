"use client";

import { useMatch } from "@/lib/match-context";
import { activeSet } from "@/engine/beach/types";
import { BeachCourt } from "@/components/court/BeachCourt";
import { BeachActionBar } from "@/components/scoring/BeachActionBar";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";
import { ScoringLog } from "@/components/scoring/ScoringLog";

export function LiveScoreboard({
  competitionName,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
}: {
  competitionName: string;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
}) {
  const { matchId, state, config, online, error, pending, serveClockDeadline } = useMatch();
  const set = activeSet(state);

  const statusLabel =
    state.status === "FINISHED"
      ? "Final"
      : set
        ? `Set ${set.setNumber}${set.ttoFired ? " · TTO done" : ""}`
        : "Match not started";

  return (
    <ScoringShell
      competitionLabel={competitionName}
      online={online}
      pending={pending}
      error={error}
      tools={<ScoringLog matchId={matchId} teamAName={teamAName} teamBName={teamBName} />}
      score={
        <ScoreStrip
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
          teamAOnLeft={(set?.teamASide ?? "LEFT") === "LEFT"}
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
      main={
        <BeachCourt
          teamASide={set?.teamASide ?? "LEFT"}
          currentServer={set?.currentServer ?? null}
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
        />
      }
      actions={
        <div className="flex flex-col gap-2">
          {config.serveClockEnabled ? (
            <ServeClockWidget deadline={serveClockDeadline} totalSecs={config.serveClockSecs} />
          ) : null}
          <BeachActionBar
            teamAName={teamAName}
            teamBName={teamBName}
            teamAColor={teamAColor}
            teamBColor={teamBColor}
          />
        </div>
      }
    />
  );
}
