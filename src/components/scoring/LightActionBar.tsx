"use client";

import { useState } from "react";
import { useLightMatch } from "@/lib/light-match-context";
import { useT } from "@/lib/i18n/client";
import { type TeamId, activeSet, oppositeSide } from "@/engine/light/types";
import { SecondaryButton } from "@/components/scoring/shared/buttons";
import { usePrePhaseBanner } from "@/components/scoring/shared/PhaseBanners";
import { useArmedConfirm } from "@/components/scoring/shared/useArmedConfirm";
import {
  LiveScoreGrid,
  SubPanel,
  TeamActionsGrid,
} from "@/components/scoring/shared/LiveControls";

export function LightActionBar() {
  const t = useT();
  const { state, config, dispatch, pending, teamAName, teamBName, teamAColor, teamBColor, rosterA, rosterB } =
    useLightMatch();
  const { armed, tapConfirm } = useArmedConfirm();
  const [subTeam, setSubTeam] = useState<TeamId | null>(null);

  const set = activeSet(state);

  const phase = usePrePhaseBanner({
    state,
    set,
    dispatch,
    teamAName,
    teamBName,
    lineupPendingText: t("scoring.lineupConfirm"),
    // Air/Light changes ends only after set 1 + at 8 in the decider (F2): the
    // deciding set keeps the previous side and switches at 8.
    nextSetStartSide: (prev, nextSetNumber) =>
      nextSetNumber >= config.bestOf
        ? prev.teamAStartSide
        : oppositeSide(prev.teamAStartSide),
  });
  if (phase) return phase;
  if (!set) return null; // unreachable — usePrePhaseBanner covers it

  // ── live scoring ──────────────────────────────────────────────────────────
  const tap = (team: TeamId) =>
    tapConfirm(team, () =>
      dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" }),
    );
  const tapUndo = () => tapConfirm("UNDO", () => dispatch({ type: "UNDO", targetEventId: "" }));
  const toFull = (t: TeamId) =>
    (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB) >= config.timeoutsPerSet;

  return (
    <div className="flex flex-col gap-3">
      <LiveScoreGrid
        teamASide={set.teamASide}
        armed={armed}
        onPoint={tap}
        onUndo={tapUndo}
        onNote={(text) => dispatch({ type: "NOTE", text })}
        pending={pending}
        teamAName={teamAName}
        teamBName={teamBName}
        teamAColor={teamAColor}
        teamBColor={teamBColor}
      />

      <TeamActionsGrid>
        {(team) => (
          <>
            <SecondaryButton disabled={toFull(team)} onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team })}>
              {t("scoring.timeout", {
                remaining:
                  config.timeoutsPerSet -
                  (team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB),
              })}
            </SecondaryButton>
            <SecondaryButton onClick={() => setSubTeam(subTeam === team ? null : team)}>
              {t("scoring.sub")}
            </SecondaryButton>
            <SecondaryButton onClick={() => dispatch({ type: "JUMP_SERVE_FOOT_FAULT", team })}>
              {t("scoring.serveFault")}
            </SecondaryButton>
            <SecondaryButton onClick={() => dispatch({ type: "ATTACK_ARC_FAULT", team })}>
              {t("scoring.arcFault")}
            </SecondaryButton>
          </>
        )}
      </TeamActionsGrid>
      <p className="text-center text-[11px] text-score-dim">
        {t("scoring.faultsHint")}
      </p>

      {subTeam ? (
        <SubPanel
          team={subTeam}
          roster={subTeam === "A" ? rosterA : rosterB}
          court={subTeam === "A" ? set.courtPositionsA : set.courtPositionsB}
          subsUsed={subTeam === "A" ? set.subsUsedA : set.subsUsedB}
          onSubstitute={(outPlayerId, inPlayerId) =>
            dispatch({ type: "SUBSTITUTION", team: subTeam, outPlayerId, inPlayerId })
          }
          onClose={() => setSubTeam(null)}
        />
      ) : null}
    </div>
  );
}
