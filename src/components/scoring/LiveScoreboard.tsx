"use client";

import { useMemo } from "react";
import { useMatch } from "@/lib/match-context";
import {
  activeSet,
  currentServerSlot,
  firstServerPlayerId,
  oppositeTeam,
  type BeachSetState,
  type PlayerNumber,
  type TeamId,
} from "@/engine/beach/types";
import type { PlayerLite } from "@/lib/match-provider";
import { useT } from "@/lib/i18n/client";
import { BeachCourt, type BeachCourtPlayer } from "@/components/court/BeachCourt";
import { surnameOf } from "@/components/court/PositionalCourt";
import { BeachActionBar } from "@/components/scoring/BeachActionBar";
import { InterruptNotifications } from "@/components/scoring/InterruptNotifications";
import { ServeClockWidget } from "@/components/scoreboard/ServeClockWidget";
import { ScoringShell, ScoreStrip } from "@/components/scoring/ScoringShell";
import { ScoringLog } from "@/components/scoring/ScoringLog";
import { SecondaryButton } from "@/components/scoring/shared/buttons";

// Beach serve order (FIVB rule 12.2): "player 1" is whoever the team declares
// as its first server for the set (SERVICE_ORDER event); player 2 is the
// pair's other player. Returns the pair in service order, or null until the
// order is declared (or when the roster isn't the regulation two players).
function pairInServiceOrder(
  roster: PlayerLite[],
  set: BeachSetState | undefined,
  team: TeamId,
): [PlayerLite, PlayerLite] | null {
  if (!set || roster.length !== 2) return null;
  const firstId = firstServerPlayerId(set, team);
  if (!firstId) return null;
  const first = roster.find((p) => p.id === firstId);
  const second = roster.find((p) => p.id !== firstId);
  return first && second ? [first, second] : null;
}

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
  const t = useT();
  const {
    matchId,
    state,
    config,
    rosterA,
    rosterB,
    dispatch,
    online,
    error,
    pending,
    queuedCount,
    serveClockDeadline,
  } = useMatch();
  const set = activeSet(state);

  const rosterById = useMemo(() => {
    const m = new Map<string, PlayerLite>();
    for (const p of [...rosterA, ...rosterB]) m.set(p.id, p);
    return m;
  }, [rosterA, rosterB]);

  const statusLabel =
    state.status === "FINISHED"
      ? "Final"
      : set
        ? `Set ${set.setNumber}${set.ttoFired ? " · TTO done" : ""}`
        : "Match not started";

  const rosterOf = (team: TeamId) => (team === "A" ? rosterA : rosterB);
  const orderedA = pairInServiceOrder(rosterA, set, "A");
  const orderedB = pairInServiceOrder(rosterB, set, "B");
  // The pair as displayed, in service order. Until the order is declared the
  // roster order stands in (slot 1 = first roster player) so the referees
  // ALWAYS see a serve indication — the one-tap prompt below confirms or
  // flips it (dispatching SERVICE_ORDER).
  const displayPair = (team: TeamId): PlayerLite[] | null => {
    const roster = rosterOf(team);
    if (roster.length !== 2) return null;
    return (team === "A" ? orderedA : orderedB) ?? roster;
  };

  // The player expected to serve, per the alternating service order.
  const servingTeam = set && !set.winner ? set.currentServer : null;
  const servingSlot: PlayerNumber | null = set && servingTeam ? currentServerSlot(set) : null;
  const servingPair = servingTeam ? displayPair(servingTeam) : null;
  const servingPlayer = servingPair && servingSlot ? servingPair[servingSlot - 1] : null;
  const servingPlayerLabel =
    state.status === "FINISHED" || !servingTeam
      ? null
      : servingPlayer
        ? servingPlayer.fullName
        : servingSlot
          ? t("scoring.playerN", { n: servingSlot })
          : null;

  // Court markers: jersey number + surname per player, ring/dot on the one
  // whose turn it is to serve.
  const courtPair = (team: TeamId): BeachCourtPlayer[] | null => {
    const pair = displayPair(team);
    if (!pair) return null;
    const slot = team === servingTeam ? servingSlot : null;
    return pair.map((p, i) => ({
      jersey: p.jerseyNumber,
      name: surnameOf(p.fullName),
      serving: slot != null && i === slot - 1,
    }));
  };

  // One-tap service-order declaration (rules: each team declares its order
  // before the set). Prompt for the serving team first, then the receiver.
  const orderPendingTeam =
    state.status === "LIVE" && set && !set.winner && servingTeam
      ? ([servingTeam, oppositeTeam(servingTeam)] as TeamId[]).find(
          (team) =>
            rosterOf(team).length === 2 && !firstServerPlayerId(set, team),
        ) ?? null
      : null;

  return (
    <ScoringShell
      competitionLabel={competitionName}
      online={online}
      pending={pending}
      error={error}
      queuedCount={queuedCount}
      tools={
        <ScoringLog
          matchId={matchId}
          teamAName={teamAName}
          teamBName={teamBName}
          rosterById={rosterById}
        />
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
          serving={servingTeam}
          servingPlayer={servingPlayerLabel}
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
          currentServer={servingTeam}
          servingSlot={servingSlot}
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
          pairA={courtPair("A")}
          pairB={courtPair("B")}
        />
      }
      actions={
        <div className="flex flex-col gap-2">
          {orderPendingTeam ? (
            <div className="flex flex-wrap items-center justify-center gap-2 rounded border border-border bg-surface-raised px-3 py-2">
              <span className="text-sm text-score-dim">
                {t("scoring.firstServerPrompt", {
                  team: orderPendingTeam === "A" ? teamAName : teamBName,
                })}
              </span>
              {rosterOf(orderPendingTeam).map((p) => (
                <SecondaryButton
                  key={p.id}
                  disabled={pending}
                  onClick={() =>
                    dispatch({
                      type: "SERVICE_ORDER",
                      team: orderPendingTeam,
                      firstServerPlayerId: p.id,
                    })
                  }
                >
                  {p.fullName}
                </SecondaryButton>
              ))}
            </div>
          ) : null}
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
