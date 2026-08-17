"use client";

import { useMemo } from "react";
import { useIndoorMatch } from "@/lib/indoor-match-context";
import { useT } from "@/lib/i18n/client";
import { activeSet } from "@/engine/indoor/types";
import { describeUndone } from "@/components/scoring/shared/undoneNotice";
import {
  ShortcutProvider,
  ShortcutSettingsButton,
} from "@/components/scoring/shared/shortcuts-context";
import { IndoorCourt } from "@/components/court/IndoorCourt";
import { IndoorActionBar } from "@/components/scoring/IndoorActionBar";
import { useResultSignOff } from "@/components/scoring/shared/ResultSignOff";
import { usePrematchSignOff } from "@/components/scoring/shared/PrematchSignOff";
import { SanctionsControl } from "@/components/scoring/shared/SanctionsControl";
import { FaultCorrection } from "@/components/scoring/shared/FaultCorrection";
import { ProtestControl } from "@/components/scoring/shared/ProtestControl";
import { RecoveryControl } from "@/components/scoring/shared/RecoveryControl";
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
    dispatch,
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
    undoneNotice,
  } = useIndoorMatch();
  const t = useT();
  const set = activeSet(state);
  const rosterById = useMemo(() => {
    const m = new Map<string, (typeof rosterA)[number]>();
    for (const p of [...rosterA, ...rosterB]) m.set(p.id, p);
    return m;
  }, [rosterA, rosterB]);

  const statusLabel =
    state.status === "FINISHED" ? "Final" : set ? `Set ${set.setNumber}` : "Match not started";

  // Post-match scoresheet sign-off (spec/20): the court zone becomes the white
  // signing area for both captains and the 1st referee.
  const signOff = useResultSignOff({
    matchId,
    finished: state.status === "FINISHED",
    policy: config.resultSignatures,
    teamAName,
    teamBName,
    rosterA,
    rosterB,
    sets: state.sets.map((s) => ({
      setNumber: s.setNumber,
      scoreA: s.scoreA,
      scoreB: s.scoreB,
    })),
    setsWonA: state.setsWonA,
    setsWonB: state.setsWonB,
    winner: state.winner,
  });

  // Pre-match captain signatures (spec/21 Phase D).
  const prematch = usePrematchSignOff({
    matchId,
    status: state.status,
    policy: config.resultSignatures,
    teamAName,
    teamBName,
    rosterA,
    rosterB,
  });

  // The starting six is the FIRST step of the flow, as on paper: the court
  // zone collects lineups from the moment the match is set up — before the
  // coin toss, Start match and Start set — and again during every set break
  // (stashed as pendingLineups, applied by SET_START). LINEUP_PENDING remains
  // the fallback for a set started without them.
  const preSetLineup =
    config.lineupRequired &&
    (state.status === "COIN_TOSS" ||
      state.status === "READY" ||
      (state.status === "LIVE" && (!set || !!set.winner)));

  let main;
  if (signOff.panel) {
    main = signOff.panel;
  } else if (prematch.panel) {
    main = prematch.panel;
  } else if (state.rallyPhase === "LINEUP_PENDING" || preSetLineup) {
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
    <ShortcutProvider>
    <ScoringShell
      competitionLabel={`${competitionName} · Indoor`}
      online={online}
      pending={pending}
      error={error}
      notice={describeUndone(t, undoneNotice)}
      queuedCount={queuedCount}
      tools={
        <>
          <ScoringLog matchId={matchId} teamAName={teamAName} teamBName={teamBName} rosterById={rosterById} />
          <ShortcutSettingsButton />
        </>
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
          <IndoorActionBar
            finishedExtra={signOff.finishedExtra}
            finishedUndoHidden={signOff.finishedUndoHidden}
          />
          <div className="flex flex-wrap items-center justify-center gap-3">
            {prematch.trigger}
            <SanctionsControl
              status={state.status}
              teamAName={teamAName}
              teamBName={teamBName}
              rosterA={rosterA}
              rosterB={rosterB}
              dispatch={dispatch}
              pending={pending}
              autoPoint={config.sanctionAutoPoint}
              misconductA={state.misconductA}
              misconductB={state.misconductB}
            />
            <RecoveryControl
              status={state.status}
              rallyPhase={state.rallyPhase}
              teamAName={teamAName}
              teamBName={teamBName}
              rosterA={rosterA}
              rosterB={rosterB}
              dispatch={dispatch}
              pending={pending}
              recoveryLimit={config.recoveriesPerPlayerPerMatch}
              recoveriesByPlayer={state.recoveriesByPlayer}
            />
            <ProtestControl
              status={state.status}
              teamAName={teamAName}
              teamBName={teamBName}
              rosterA={rosterA}
              rosterB={rosterB}
              dispatch={dispatch}
              pending={pending}
            />
            {set ? (
              <FaultCorrection
                matchId={matchId}
                status={state.status}
                rotationEnabled={config.rotationEnabled}
                setNumber={set.setNumber}
                teamAName={teamAName}
                teamBName={teamBName}
                dispatch={dispatch}
                pending={pending}
              />
            ) : null}
          </div>
        </div>
      }
      overlay={
        config.teamTabletEnabled ? (
          <InterruptNotifications
            matchId={matchId}
            teamAName={teamAName}
            teamBName={teamBName}
            active={state.status !== "FINISHED"}
            rosterById={rosterById}
          />
        ) : null
      }
    />
    </ShortcutProvider>
  );
}
