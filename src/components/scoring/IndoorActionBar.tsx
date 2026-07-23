"use client";

import { useState } from "react";
import { useIndoorMatch } from "@/lib/indoor-match-context";
import { timeoutCapForSet } from "@/engine/config";
import { useT } from "@/lib/i18n/client";
import {
  type IndoorSetState,
  type TeamId,
  activeSet,
} from "@/engine/indoor/types";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import {
  Banner,
  PanelConfirm,
  PrimaryButton,
  SecondaryButton,
  SelectRow,
} from "@/components/scoring/shared/buttons";
import { usePrePhaseBanner } from "@/components/scoring/shared/PhaseBanners";
import { ForfeitControl } from "@/components/scoring/shared/ForfeitControl";
import { useShortcut } from "@/components/scoring/shared/shortcuts-context";
import { useArmedConfirm } from "@/components/scoring/shared/useArmedConfirm";
import {
  LiveScoreGrid,
  SubPanel,
  TeamActionsGrid,
} from "@/components/scoring/shared/LiveControls";

export function IndoorActionBar() {
  const t = useT();
  const { state, config, dispatch, pending, teamAName, teamBName, teamAColor, teamBColor, rosterA, rosterB } =
    useIndoorMatch();
  const { armed, tapConfirm } = useArmedConfirm();
  const [subTeam, setSubTeam] = useState<TeamId | null>(null);
  const [liberoTeam, setLiberoTeam] = useState<TeamId | null>(null);

  const set = activeSet(state);
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);

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
    lineupPendingText: t("scoring.lineupWait"),
    extraPhase:
      state.rallyPhase === "VCS_ACTIVE" && set ? (
        <Banner>
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm text-score-dim">
              {t("scoring.videoChallenge", {
                team: name(set.vcs.activeChallenge?.team ?? "A"),
              })}
            </span>
            <div className="flex gap-3">
              <PrimaryButton
                onClick={() =>
                  dispatch({ type: "VCS_RESULT", upheld: true, team: set.vcs.activeChallenge?.team ?? "A" })
                }
              >
                {t("scoring.upheld")}
              </PrimaryButton>
              <SecondaryButton
                onClick={() =>
                  dispatch({ type: "VCS_RESULT", upheld: false, team: set.vcs.activeChallenge?.team ?? "A" })
                }
              >
                {t("scoring.rejected")}
              </SecondaryButton>
            </div>
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

      {/* Per-team officiating row */}
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
            {config.liberoEnabled ? (
              <SecondaryButton onClick={() => setLiberoTeam(liberoTeam === team ? null : team)}>
                {t("scoring.libero")}
              </SecondaryButton>
            ) : null}
            {config.vcsEnabled ? (
              <SecondaryButton
                disabled={
                  (team === "A"
                    ? set.vcs.challengesRemainingA
                    : set.vcs.challengesRemainingB) <= 0
                }
                onClick={() => dispatch({ type: "VCS_CHALLENGE", team })}
              >
                {t("scoring.challenge", {
                  remaining:
                    team === "A"
                      ? set.vcs.challengesRemainingA
                      : set.vcs.challengesRemainingB,
                })}
              </SecondaryButton>
            ) : null}
          </>
        )}
      </TeamActionsGrid>

      {subTeam ? (
        <SubPanel
          team={subTeam}
          roster={subTeam === "A" ? rosterA : rosterB}
          court={subTeam === "A" ? set.courtPositionsA : set.courtPositionsB}
          subsUsed={subTeam === "A" ? set.subsUsedA : set.subsUsedB}
          excludeIds={liberoIdsOf(set, subTeam)}
          onSubstitute={(outPlayerId, inPlayerId) =>
            dispatch({ type: "SUBSTITUTION", team: subTeam, outPlayerId, inPlayerId })
          }
          onClose={() => setSubTeam(null)}
        />
      ) : null}
      {liberoTeam ? (
        <LiberoPanel team={liberoTeam} onClose={() => setLiberoTeam(null)} />
      ) : null}
      {forfeit}
    </div>
  );
}

// ── libero panel (indoor-only) ───────────────────────────────────────────────

function LiberoPanel({ team, onClose }: { team: TeamId; onClose: () => void }) {
  const t = useT();
  const { state, dispatch, rosterA, rosterB } = useIndoorMatch();
  const set = activeSet(state)!;
  const roster = team === "A" ? rosterA : rosterB;
  const onCourt = team === "A" ? set.libero.liberoOnCourtA : set.libero.liberoOnCourtB;
  const liberoId = team === "A" ? set.libero.liberoIdA : set.libero.liberoIdB;
  const replacing = team === "A" ? set.libero.liberoReplacingA : set.libero.liberoReplacingB;
  const court = team === "A" ? set.courtPositionsA : set.courtPositionsB;
  // Back-row positions are 1,5,6 → indices 0,4,5 (but pos 1 serves; libero usually 5/6).
  const backRow = [5, 6].map((p) => court[p - 1]).filter(Boolean);
  const [outId, setOutId] = useState(backRow[0] ?? "");
  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };

  if (!liberoId)
    return (
      <ScoringModal title={t("scoring.libero")} onClose={onClose}>
        <p className="text-sm text-score-dim">{t("scoring.noLibero")}</p>
      </ScoringModal>
    );

  return (
    <ScoringModal title={t("scoring.liberoTitle", { player: label(liberoId) })} onClose={onClose}>
      {onCourt ? (
        <PanelConfirm
          onClick={() => {
            dispatch({
              type: "LIBERO_REPLACEMENT",
              team,
              liberoId,
              direction: "OUT",
              outPlayerId: replacing ?? "",
            });
            onClose();
          }}
        >
          {t("scoring.liberoOut", {
            player: replacing ? label(replacing) : t("scoring.player"),
          })}
        </PanelConfirm>
      ) : (
        <>
          <SelectRow label={t("scoring.out")} value={outId} onChange={setOutId} options={backRow} optionLabel={label} />
          <PanelConfirm
            disabled={!outId}
            onClick={() => {
              dispatch({
                type: "LIBERO_REPLACEMENT",
                team,
                liberoId,
                direction: "IN",
                outPlayerId: outId,
              });
              onClose();
            }}
          >
            {t("scoring.liberoIn", { player: label(outId) })}
          </PanelConfirm>
        </>
      )}
    </ScoringModal>
  );
}

function liberoIdsOf(set: IndoorSetState, team: TeamId): string[] {
  const ids =
    team === "A"
      ? [set.libero.liberoIdA, set.libero.secondLiberoIdA]
      : [set.libero.liberoIdB, set.libero.secondLiberoIdB];
  return ids.filter((x): x is string => Boolean(x));
}
