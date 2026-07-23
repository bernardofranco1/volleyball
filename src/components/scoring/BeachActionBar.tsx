"use client";

import { useMatch } from "@/lib/match-context";
import { timeoutCapForSet } from "@/engine/config";
import { useT } from "@/lib/i18n/client";
import { type TeamId, activeSet } from "@/engine/beach/types";
import {
  Banner,
  PrimaryButton,
  SecondaryButton,
} from "@/components/scoring/shared/buttons";
import { usePrePhaseBanner } from "@/components/scoring/shared/PhaseBanners";
import { useArmedConfirm } from "@/components/scoring/shared/useArmedConfirm";
import { LiveScoreGrid } from "@/components/scoring/shared/LiveControls";
import { ForfeitControl } from "@/components/scoring/shared/ForfeitControl";
import {
  ShortcutAction,
  useShortcut,
} from "@/components/scoring/shared/shortcuts-context";

export function BeachActionBar({
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
}: {
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
}) {
  const t = useT();
  const { state, config, dispatch, pending } = useMatch();
  const { armed, tapConfirm } = useArmedConfirm();

  const set = activeSet(state);

  // scope "point": sweep set-start bookkeeping (SET_START / SERVICE_ORDER) and
  // undo the last real action in one atomic server-side batch.
  const tapUndo = () =>
    tapConfirm("UNDO", () =>
      dispatch({ type: "UNDO", targetEventId: "", scope: "point" }),
    );
  const tap = (team: TeamId) =>
    tapConfirm(team, () =>
      dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" }),
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
    nextSetDisabled: pending,
    pending,
    teamAColor,
    teamBColor,
    extraPhase:
      state.rallyPhase === "TTO_ACTIVE" ? (
        // A mis-tapped point can be what triggered this TTO — offer Undo here.
        // The server undoes the rally AND its auto-emitted TTO_START together.
        <Banner>
          <div className="flex flex-col items-center gap-2">
            <ShortcutAction id="advance" run={() => dispatch({ type: "TTO_END" })} />
            <ShortcutAction id="undo" run={tapUndo} />
            <PrimaryButton onClick={() => dispatch({ type: "TTO_END" })}>
              {t("scoring.endTto")}
            </PrimaryButton>
            <SecondaryButton armed={armed === "UNDO"} onClick={tapUndo} disabled={pending}>
              {armed === "UNDO" ? t("scoring.confirmUndo") : t("scoring.undoLastPoint")}
            </SecondaryButton>
          </div>
        </Banner>
      ) : null,
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

  // ── live scoring (BETWEEN_RALLIES / RALLY_LIVE) ───────────────────────────
  const timeoutCap = timeoutCapForSet(config, set.setNumber);
  const timeoutFull = (t: TeamId) =>
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
        armedPointLabel={(teamName) => t("scoring.confirmPoint", { team: teamName })}
        confirmUndoLabel={confirmUndoLabel}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <SecondaryButton
          disabled={timeoutFull("A")}
          onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: "A" })}
        >
          {t("scoring.timeoutTeam", {
            team: teamAName,
            remaining: timeoutCap - set.timeoutsUsedA,
          })}
        </SecondaryButton>
        <SecondaryButton
          disabled={timeoutFull("B")}
          onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: "B" })}
        >
          {t("scoring.timeoutTeam", {
            team: teamBName,
            remaining: timeoutCap - set.timeoutsUsedB,
          })}
        </SecondaryButton>
      </div>
      {forfeit}
    </div>
  );
}
