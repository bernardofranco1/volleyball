"use client";

import { useState } from "react";
import { useGrassMatch } from "@/lib/grass-match-context";
import { timeoutCapForSet } from "@/engine/config";
import { useT } from "@/lib/i18n/client";
import { type TeamId, activeSet } from "@/engine/grass/types";
import { SecondaryButton } from "@/components/scoring/shared/buttons";
import { usePrePhaseBanner } from "@/components/scoring/shared/PhaseBanners";
import { ForfeitControl } from "@/components/scoring/shared/ForfeitControl";
import { useShortcut } from "@/components/scoring/shared/shortcuts-context";
import { useArmedConfirm } from "@/components/scoring/shared/useArmedConfirm";
import {
  LiveScoreGrid,
  SubPanel,
  TeamActionsGrid,
} from "@/components/scoring/shared/LiveControls";

export function GrassActionBar() {
  const t = useT();
  const { state, config, dispatch, pending, teamAName, teamBName, teamAColor, teamBColor, rosterA, rosterB } =
    useGrassMatch();
  const { armed, tapConfirm } = useArmedConfirm();
  const [subTeam, setSubTeam] = useState<TeamId | null>(null);

  const set = activeSet(state);

  const tap = (team: TeamId) =>
    tapConfirm(team, () =>
      dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" }),
    );
  // scope "point": sweep set-start bookkeeping (SET_START / LINEUP_CONFIRMED)
  // and undo the last real action in one atomic server-side batch.
  const tapUndo = () =>
    tapConfirm("UNDO", () =>
      dispatch({ type: "UNDO", targetEventId: "", scope: "point" }),
    );
  const tapReplay = () =>
    tapConfirm("REPLAY", () => dispatch({ type: "REPLAY_POINT" }));

  const phase = usePrePhaseBanner({
    state,
    set,
    dispatch,
    teamAName,
    teamBName,
    config,
    pending,
    teamAColor,
    teamBColor,
    lineupPendingText: t("scoring.lineupConfirm"),
  });
  // ── keyboard shortcuts: bound to what's on screen (left/right follow the
  // court sides); every handler goes through the same two-tap arming as touch.
  const live = !phase && !!set && state.status === "LIVE";
  const leftTeam: TeamId = set?.teamASide === "RIGHT" ? "B" : "A";
  const rightTeam: TeamId = leftTeam === "A" ? "B" : "A";
  const requestTimeout = (team: TeamId) => {
    if (!set) return;
    const cap = timeoutCapForSet(config, set.setNumber);
    if ((team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB) >= cap) return;
    dispatch({ type: "TIMEOUT_REQUEST", team });
  };
  const promptNote = () => {
    const text = window.prompt(t("scoring.note"));
    if (text) dispatch({ type: "NOTE", text });
  };
  useShortcut("pointLeft", live ? () => tap(leftTeam) : null);
  useShortcut("pointRight", live ? () => tap(rightTeam) : null);
  useShortcut("replay", live ? tapReplay : null);
  useShortcut("undo", live ? tapUndo : null);
  useShortcut("timeoutLeft", live ? () => requestTimeout(leftTeam) : null);
  useShortcut("timeoutRight", live ? () => requestTimeout(rightTeam) : null);
  useShortcut("note", live ? promptNote : null);

  const forfeit = (
    <ForfeitControl
      status={state.status}
      teamAName={teamAName}
      teamBName={teamBName}
      dispatch={dispatch}
      pending={pending}
    />
  );
  if (phase)
    return (
      <div className="flex flex-col gap-2">
        {phase}
        {forfeit}
      </div>
    );
  if (!set) return null; // unreachable — usePrePhaseBanner covers it

  // ── live scoring ──────────────────────────────────────────────────────────
  const timeoutCap = timeoutCapForSet(config, set.setNumber);
  const toFull = (t: TeamId) =>
    (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB) >= timeoutCap;
  // At a fresh-set boundary (0-0, later set) the point-scoped undo reopens the
  // previous set — the armed label says so before the scorer commits.
  const confirmUndoLabel =
    set.scoreA + set.scoreB === 0 && set.setNumber > 1
      ? t("scoring.confirmUndoPoint", { set: set.setNumber - 1 })
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <LiveScoreGrid
        teamASide={set.teamASide}
        armed={armed}
        onPoint={tap}
        onUndo={tapUndo}
        onReplay={tapReplay}
        onNote={(text) => dispatch({ type: "NOTE", text })}
        pending={pending}
        teamAName={teamAName}
        teamBName={teamBName}
        teamAColor={teamAColor}
        teamBColor={teamBColor}
        confirmUndoLabel={confirmUndoLabel}
      />

      <TeamActionsGrid>
        {(team) => (
          <>
            <SecondaryButton disabled={toFull(team)} onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team })}>
              {t("scoring.timeout", {
                remaining:
                  timeoutCap -
                  (team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB),
              })}
            </SecondaryButton>
            <SecondaryButton onClick={() => setSubTeam(subTeam === team ? null : team)}>
              {t("scoring.sub")}
            </SecondaryButton>
          </>
        )}
      </TeamActionsGrid>

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
      {forfeit}
    </div>
  );
}
