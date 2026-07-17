"use client";

// Scorer console layout shared by grass & light (rotation disciplines with a
// serve clock, one-event lineup confirmation and team-tablet interrupts). The
// thin GrassScoreboard/LightScoreboard wrappers supply the discipline pieces.
import { useMemo } from "react";
import type { TournamentConfig } from "@/engine/config";
import { activeSet, type Side, type TeamId } from "@/engine/types";
import type { PlayerLite } from "@/lib/match-provider";
import { InterruptNotifications } from "@/components/scoring/InterruptNotifications";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";
import { ScoringLog } from "@/components/scoring/ScoringLog";

/** The slice of a set state the scoreboard needs (grass & light both match). */
export interface RotationSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: TeamId | null;
  teamASide: Side;
  currentServer: TeamId;
  courtPositionsA: string[];
  courtPositionsB: string[];
  lastRotA: number | null;
  lastRotB: number | null;
}

export interface RotationMatchState {
  status: string;
  rallyPhase: string;
  setsWonA: number;
  setsWonB: number;
  currentSetNumber: number;
  sets: RotationSet[];
}

export interface RotationCourtProps {
  courtPositionsA: string[];
  courtPositionsB: string[];
  currentServer: TeamId | null;
  lastRotA: number | null;
  lastRotB: number | null;
  teamASide: Side;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  rosterById: Map<string, PlayerLite>;
}

export function RotationScoreboard({
  disciplineLabel,
  competitionName,
  ctx,
  Court,
  lineupEntry,
  actionBar,
}: {
  disciplineLabel: string;
  competitionName: string;
  ctx: {
    matchId: string;
    state: RotationMatchState;
    config: TournamentConfig;
    rosterA: PlayerLite[];
    rosterB: PlayerLite[];
    teamAName: string;
    teamBName: string;
    teamAColor: string | null;
    teamBColor: string | null;
    online: boolean;
    pending: boolean;
    error: string | null;
    queuedCount: number;
    serveClockDeadline: number | null;
  };
  Court: React.ComponentType<RotationCourtProps>;
  lineupEntry: React.ReactNode;
  actionBar: React.ReactNode;
}) {
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
  } = ctx;
  const set = activeSet(state);
  const rosterById = useMemo(() => {
    const m = new Map<string, PlayerLite>();
    for (const p of [...rosterA, ...rosterB]) m.set(p.id, p);
    return m;
  }, [rosterA, rosterB]);

  const statusLabel =
    state.status === "FINISHED" ? "Final" : set ? `Set ${set.setNumber}` : "Match not started";

  // The court diagram marks the expected server (position 1) with a ring.
  const serving = set && !set.winner && state.status !== "FINISHED" ? set.currentServer : null;

  let main;
  if (state.rallyPhase === "LINEUP_PENDING") {
    main = lineupEntry;
  } else if (set && set.courtPositionsA.length > 0) {
    main = (
      <Court
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
      competitionLabel={`${competitionName} · ${disciplineLabel} ${config.playersPerSide}v${config.playersPerSide}`}
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
          serving={serving}
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
          {actionBar}
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
