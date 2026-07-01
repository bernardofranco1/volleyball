"use client";

import { useMemo } from "react";
import { useIndoorMatch } from "@/lib/indoor-match-context";
import { activeSet } from "@/engine/indoor/types";
import { IndoorCourt } from "@/components/court/IndoorCourt";
import { IndoorActionBar } from "@/components/scoring/IndoorActionBar";
import { IndoorLineupEntry } from "@/components/scoring/IndoorLineupEntry";
import { InterruptNotifications } from "@/components/scoring/InterruptNotifications";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";
import { ScoringLog } from "@/components/scoring/ScoringLog";

export function IndoorScoreboard({ competitionName }: { competitionName: string }) {
  const {
    matchId,
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
    queuedCount,
    serveClockDeadline,
  } = useIndoorMatch();
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
    main = <IndoorLineupEntry />;
  } else if (set && set.courtPositionsA.length > 0) {
    main = (
      <IndoorCourt
        courtPositionsA={set.courtPositionsA}
        courtPositionsB={set.courtPositionsB}
        currentServer={set.currentServer}
        teamASide={set.teamASide}
        teamAName={teamAName}
        teamBName={teamBName}
        teamAColor={teamAColor}
        teamBColor={teamBColor}
        rosterById={rosterById}
        liberoIdA={set.libero.liberoOnCourtA ? set.libero.liberoIdA : null}
        liberoIdB={set.libero.liberoOnCourtB ? set.libero.liberoIdB : null}
      />
    );
  } else {
    main = <p className="text-center text-sm text-score-dim">Set up the match to begin.</p>;
  }

  return (
    <ScoringShell
      competitionLabel={`${competitionName} · Indoor`}
      online={online}
      pending={pending}
      error={error}
      queuedCount={queuedCount}
      tools={
        <ScoringLog matchId={matchId} teamAName={teamAName} teamBName={teamBName} rosterById={rosterById} />
      }
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
      main={main}
      actions={
        <div className="flex flex-col gap-2">
          {config.serveClockEnabled ? (
            <ServeClockWidget deadline={serveClockDeadline} totalSecs={config.serveClockSecs} />
          ) : null}
          <IndoorActionBar />
        </div>
      }
      overlay={
        config.teamTabletEnabled ? (
          <InterruptNotifications
            matchId={matchId}
            teamAName={teamAName}
            teamBName={teamBName}
            active={state.status !== "FINISHED"}
          />
        ) : null
      }
    />
  );
}
