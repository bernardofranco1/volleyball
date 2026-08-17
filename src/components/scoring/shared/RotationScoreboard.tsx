"use client";

// Scorer console layout shared by grass & light (rotation disciplines with a
// serve clock, one-event lineup confirmation and team-tablet interrupts). The
// thin GrassScoreboard/LightScoreboard wrappers supply the discipline pieces.
import { useMemo } from "react";
import type { TournamentConfig } from "@/engine/config";
import { activeSet, type Side, type TeamId } from "@/engine/types";
import type { PlayerLite } from "@/lib/match-provider";
import { useT } from "@/lib/i18n/client";
import { InterruptNotifications } from "@/components/scoring/InterruptNotifications";
import { SanctionsControl } from "@/components/scoring/shared/SanctionsControl";
import { ProtestControl } from "@/components/scoring/shared/ProtestControl";
import {
  FaultCorrection,
  type FaultDispatch,
} from "@/components/scoring/shared/FaultCorrection";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";
import { ScoringLog } from "@/components/scoring/ScoringLog";
import { describeUndone } from "@/components/scoring/shared/undoneNotice";
import {
  ShortcutProvider,
  ShortcutSettingsButton,
} from "@/components/scoring/shared/shortcuts-context";

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

type SanctionPayload = Parameters<
  React.ComponentProps<typeof SanctionsControl>["dispatch"]
>[0];
type ProtestPayload = Parameters<
  React.ComponentProps<typeof ProtestControl>["dispatch"]
>[0];
type FaultPayload = Parameters<FaultDispatch>[0];

export interface RotationMatchState {
  status: string;
  rallyPhase: string;
  setsWonA: number;
  setsWonB: number;
  currentSetNumber: number;
  sets: RotationSet[];
  /** Lineup declared before the next set exists (spec/21 flow fix). */
  pendingLineup?: { teamAPlayerIds: string[]; teamBPlayerIds: string[] } | null;
  /** Cards held, for the sanctions escalation warning (spec/29 F6). */
  misconductA?: { type: string; playerId: string }[];
  misconductB?: { type: string; playerId: string }[];
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
    /**
     * Officiating events — sanctions, positional faults, protests (spec/29
     * F6). Typed as the union of what the three shared controls emit; the
     * grass and light providers accept their own discipline payloads, which
     * are supersets of these.
     */
    dispatch: (
      payload: SanctionPayload | ProtestPayload | FaultPayload,
    ) => void;
    error: string | null;
    queuedCount: number;
    serveClockDeadline: number | null;
    undoneNotice: string[] | null;
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
    dispatch,
    error,
    queuedCount,
    serveClockDeadline,
    undoneNotice,
  } = ctx;
  const t = useT();
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

  // Lineups come BEFORE the set, as on paper (spec/21 flow fix): once the
  // toss is done, the court zone collects them pre-match (READY) and during
  // every set break, until the scorer submits (stashed as pendingLineup and
  // applied by SET_START). LINEUP_PENDING remains the fallback for a set
  // started without one.
  const preSetLineup =
    (config.lineupRequired ?? true) &&
    (state.status === "COIN_TOSS" ||
      state.status === "READY" ||
      (state.status === "LIVE" && (!set || !!set.winner))) &&
    !state.pendingLineup;

  let main;
  if (state.rallyPhase === "LINEUP_PENDING" || preSetLineup) {
    main = lineupEntry;
  } else if (state.pendingLineup && (!set || set.winner)) {
    main = (
      <p className="text-center text-sm text-score-dim">
        {t("scoring.lineupSaved")}
      </p>
    );
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
    <ShortcutProvider>
    <ScoringShell
      competitionLabel={`${competitionName} · ${disciplineLabel} ${config.playersPerSide}v${config.playersPerSide}`}
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
          {/* Capture parity (spec/29 F6): grass and light had no way to record
              a sanction, a positional fault or a protest — the events existed
              in the shared chassis, only the consoles never offered them.
              Their own sheets stay out of scope; the LOG is what matters. */}
          <SanctionsControl
            status={state.status}
            teamAName={teamAName}
            teamBName={teamBName}
            rosterA={rosterA}
            rosterB={rosterB}
            dispatch={dispatch}
            pending={pending}
            autoPoint={config.sanctionAutoPoint}
            misconductA={state.misconductA ?? []}
            misconductB={state.misconductB ?? []}
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
    </ShortcutProvider>
  );
}
