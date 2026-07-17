"use client";

// Pre-live phase state machine shared by all four discipline action bars:
// FINISHED / SET_BREAK / TIMEOUT_ACTIVE / MEDICAL_TIMEOUT_ACTIVE /
// LINEUP_PENDING / SETUP / COIN_TOSS / READY / start-set banners.
// Discipline-specific interstitials (beach TTO, indoor VCS) plug in via
// `extraPhase`; the live scoring UI stays in each bar.
import { useEffect, useRef, useState } from "react";
import { oppositeSide, oppositeTeam, type Side, type TeamId } from "@/engine/types";
import { type TournamentConfig, setBreakSecsAfter } from "@/engine/config";
import { useCountdown } from "@/components/scoreboard/Countdown";
import { useT } from "@/lib/i18n/client";
import { Banner, PrimaryButton, SecondaryButton } from "./buttons";
import { CountdownOverlay } from "./CountdownOverlay";
import { useArmedConfirm } from "./useArmedConfirm";

/** The slice of a set state the phase banners need (all four engines match). */
export interface PhaseSet {
  setNumber: number;
  firstServer: TeamId;
  teamAStartSide: Side;
  winner: TeamId | null;
}

/** The slice of a match state the phase banners need (all four engines match). */
export interface PhaseMatchState {
  matchId: string;
  status: string;
  rallyPhase: string;
  winner: TeamId | null;
  setsWonA: number;
  setsWonB: number;
  currentSetNumber: number;
  set1FirstServer: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  activeTimeoutStartedAt?: string | null;
  setBreakStartedAt?: string | null;
  sets: PhaseSet[];
}

/** Events the shared banners dispatch — a narrowing of every engine payload. */
export type PhaseDispatch = (
  payload:
    | { type: "MATCH_CREATED"; matchId: string }
    | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
    | { type: "MATCH_START" }
    | {
        type: "SET_START";
        setNumber: number;
        firstServer: TeamId;
        teamAStartSide: Side;
      }
    | { type: "TIMEOUT_END"; team: TeamId }
    | { type: "MEDICAL_TIMEOUT_END" }
    | { type: "UNDO"; targetEventId: string },
) => void;

export interface PrePhaseOptions {
  state: PhaseMatchState;
  set: PhaseSet | undefined;
  dispatch: PhaseDispatch;
  teamAName: string;
  teamBName: string;
  /** Resolved config — enables the time-out / set-break countdown + auto-advance. */
  config?: TournamentConfig;
  /** Which side team A starts on in the set after a break (default: switch ends). */
  nextSetStartSide?: (prev: PhaseSet, nextSetNumber: number) => Side;
  /** Disable "Start next set" while a dispatch is in flight (beach). */
  nextSetDisabled?: boolean;
  /** Copy for the LINEUP_PENDING banner; omit for disciplines without lineups. */
  lineupPendingText?: string;
  /** Discipline-specific interstitial banner (beach TTO, indoor VCS), or null. */
  extraPhase?: React.ReactElement | null;
}

/**
 * Returns the banner for the current pre-live/interstitial phase, or null when
 * the bar should render its live scoring controls. Call unconditionally at the
 * top of the bar (it is a hook: it remembers the coin-toss side choice so the
 * "Start set 1" banner can dispatch the side actually chosen at the toss).
 */
export function usePrePhaseBanner({
  state,
  set,
  dispatch,
  teamAName,
  teamBName,
  config,
  nextSetStartSide,
  nextSetDisabled,
  lineupPendingText,
  extraPhase,
}: PrePhaseOptions): React.ReactElement | null {
  const t = useT();
  // Side chosen for team A at the coin toss; consumed by the set-1 start banner.
  const [tossSide, setTossSide] = useState<Side>("LEFT");
  // Armed confirm for the match-won banner's Undo (un-finishing a match is
  // consequential enough to warrant a second tap).
  const { armed, tapConfirm } = useArmedConfirm();
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);
  const nextSide = nextSetStartSide ?? ((prev: PhaseSet) => oppositeSide(prev.teamAStartSide));

  // Undo the last scorer action — reachable even under the countdown overlays,
  // so a mis-tapped time-out (or the point that ended a set) can be reverted.
  // The server resolves the actual target; "" is the standard placeholder.
  const undo = () => dispatch({ type: "UNDO", targetEventId: "" });

  // Advance to the next set (shared by the manual button and the auto-advance
  // timer): opposite first-server, side per the discipline's rule. Guarded
  // against starting a set beyond bestOf — a rewind that erases MATCH_END can
  // leave the FINAL set parked in SET_BREAK with a long-past deadline, and an
  // unguarded auto-advance would fabricate a phantom extra set.
  const startNextSet = () => {
    if (!set) return;
    const nextSetNumber = state.currentSetNumber + 1;
    if (config && nextSetNumber > config.bestOf) return;
    // Mark this break's deadline as consumed: if an undo of the SET_START
    // brings the match back to this SAME (now long-expired) break, the
    // auto-advance below must not instantly re-start the set — that made
    // Undo appear to do nothing and blocked undoing the set-winning point.
    if (setBreakDeadline) firedRef.current = `sb:${setBreakDeadline}`;
    dispatch({
      type: "SET_START",
      setNumber: nextSetNumber,
      firstServer: oppositeTeam(set.firstServer),
      teamAStartSide: nextSide(set, nextSetNumber),
    });
  };

  // ── Time-out & set-break countdowns (drive the floating overlay + auto-advance).
  // Deadlines derive from the server event timestamp so scorer/tablet/board agree.
  const timeoutDeadline =
    config && state.rallyPhase === "TIMEOUT_ACTIVE" && state.activeTimeoutStartedAt
      ? Date.parse(state.activeTimeoutStartedAt) + config.timeoutDurationSecs * 1000
      : null;
  const setBreakDeadline =
    config && state.rallyPhase === "SET_BREAK" && state.setBreakStartedAt
      ? Date.parse(state.setBreakStartedAt) +
        setBreakSecsAfter(config, state.currentSetNumber) * 1000
      : null;
  const timeoutMs = useCountdown(timeoutDeadline);
  const setBreakMs = useCountdown(setBreakDeadline);

  // Auto-fire at the DEADLINE via absolute-time timers — deliberately not
  // derived from the display countdown's tick state (which reports a stale 0
  // for one frame when a fresh deadline appears; acting on that would end a
  // time-out the instant it started). A deadline already in the past fires
  // immediately (scorer loads mid-overdue-timeout → auto-resume). `firedRef`
  // dedupes per countdown instance across re-renders.
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!timeoutDeadline) return;
    const key = `to:${timeoutDeadline}`;
    const id = setTimeout(() => {
      if (firedRef.current === key) return;
      firedRef.current = key;
      dispatch({ type: "TIMEOUT_END", team: state.activeTimeoutTeam ?? "A" });
    }, Math.max(0, timeoutDeadline - Date.now()));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutDeadline]);
  useEffect(() => {
    if (!setBreakDeadline) return;
    const key = `sb:${setBreakDeadline}`;
    const id = setTimeout(() => {
      if (firedRef.current === key) return;
      firedRef.current = key;
      startNextSet();
    }, Math.max(0, setBreakDeadline - Date.now()));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBreakDeadline]);

  if (state.status === "FINISHED")
    // The winning point ends the match with no confirmation step, so the
    // banner must keep a way out: Undo (two-tap) reverts a mis-tapped final
    // point and brings the match back to LIVE. (The result itself still awaits
    // manager confirmation before it counts — spec/17 feature 5.)
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span>
            🏆{" "}
            {t("scoring.matchWon", {
              team: name(state.winner ?? "A"),
              setsA: state.setsWonA,
              setsB: state.setsWonB,
            })}
          </span>
          <SecondaryButton
            armed={armed === "UNDO"}
            onClick={() => tapConfirm("UNDO", undo)}
          >
            {armed === "UNDO" ? t("scoring.confirmUndo") : t("scoring.undoLastPoint")}
          </SecondaryButton>
        </div>
      </Banner>
    );

  if (state.rallyPhase === "SET_BREAK") {
    // With config we show the floating countdown and auto-advance at 0:00.
    // (Not in the beyond-bestOf rewind edge — fall through to the manual banner.)
    if (setBreakDeadline && config && state.currentSetNumber < config.bestOf)
      return (
        <CountdownOverlay
          title={t("scoring.setBreak")}
          subtitle={t("scoring.setEnded", {
            set: set?.setNumber ?? "",
            setsA: state.setsWonA,
            setsB: state.setsWonB,
          })}
          ms={setBreakMs}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <SecondaryButton disabled={nextSetDisabled} onClick={startNextSet}>
                {t("scoring.startNextSet")}
              </SecondaryButton>
              <SecondaryButton onClick={undo}>{t("scoring.undo")}</SecondaryButton>
            </div>
          }
        />
      );
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span>
            {t("scoring.setEnded", {
              set: set?.setNumber ?? "",
              setsA: state.setsWonA,
              setsB: state.setsWonB,
            })}
          </span>
          <PrimaryButton disabled={nextSetDisabled} onClick={startNextSet}>
            {t("scoring.startNextSet")}
          </PrimaryButton>
        </div>
      </Banner>
    );
  }

  if (state.rallyPhase === "TIMEOUT_ACTIVE") {
    const to = state.activeTimeoutTeam ?? "A";
    if (timeoutDeadline)
      return (
        <CountdownOverlay
          title={`${name(to)} · ${t("scoring.timeoutLabel")}`}
          ms={timeoutMs}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <SecondaryButton
                onClick={() => dispatch({ type: "TIMEOUT_END", team: to })}
              >
                {t("scoring.endTimeout", { team: name(to) })}
              </SecondaryButton>
              <SecondaryButton onClick={undo}>{t("scoring.undo")}</SecondaryButton>
            </div>
          }
        />
      );
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "TIMEOUT_END", team: to })}>
          {t("scoring.endTimeout", { team: name(to) })}
        </PrimaryButton>
      </Banner>
    );
  }

  if (extraPhase) return extraPhase;

  if (state.rallyPhase === "MEDICAL_TIMEOUT_ACTIVE")
    return (
      <Banner>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <PrimaryButton onClick={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })}>
            {t("scoring.endMedicalTimeout")}
          </PrimaryButton>
          <SecondaryButton onClick={undo}>{t("scoring.undo")}</SecondaryButton>
        </div>
      </Banner>
    );

  if (lineupPendingText && state.rallyPhase === "LINEUP_PENDING")
    return (
      <Banner>
        <span className="text-sm text-score-dim">{lineupPendingText}</span>
      </Banner>
    );

  if (state.status === "SETUP")
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "MATCH_CREATED", matchId: state.matchId })}>
          {t("scoring.setUpMatch")}
        </PrimaryButton>
      </Banner>
    );

  if (state.status === "COIN_TOSS")
    return (
      <CoinTossBanner
        teamAName={teamAName}
        teamBName={teamBName}
        onToss={(firstServer, teamAStartSide) => {
          setTossSide(teamAStartSide);
          dispatch({ type: "COIN_TOSS", firstServer, teamAStartSide });
        }}
      />
    );

  if (state.status === "READY")
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "MATCH_START" })}>
          {t("scoring.startMatch")}
        </PrimaryButton>
      </Banner>
    );

  // status LIVE but no active (unfinished) set yet → start the set. Set 1 uses
  // the side chosen at the coin toss; later sets derive from the previous set.
  if (!set || set.winner) {
    const prev = state.sets[state.currentSetNumber - 2];
    const teamAStartSide =
      state.currentSetNumber === 1
        ? tossSide
        : prev
          ? nextSide(prev, state.currentSetNumber)
          : "LEFT";
    return (
      <Banner>
        <PrimaryButton
          onClick={() =>
            dispatch({
              type: "SET_START",
              setNumber: state.currentSetNumber,
              firstServer: state.set1FirstServer ?? "A",
              teamAStartSide,
            })
          }
        >
          {t("scoring.startSet", { set: state.currentSetNumber })}
        </PrimaryButton>
      </Banner>
    );
  }

  return null;
}

// ── coin toss ────────────────────────────────────────────────────────────────

/**
 * Two-step coin toss, thumb-zone friendly: first pick who serves, then which
 * side team A starts on (previously hardcoded to LEFT, which flipped every
 * subsequent side-switch display when team A actually started right).
 */
function CoinTossBanner({
  teamAName,
  teamBName,
  onToss,
}: {
  teamAName: string;
  teamBName: string;
  onToss: (firstServer: TeamId, teamAStartSide: Side) => void;
}) {
  const t = useT();
  const [firstServer, setFirstServer] = useState<TeamId | null>(null);

  return (
    <Banner>
      <div className="flex flex-col items-center gap-3">
        {firstServer === null ? (
          <>
            <span className="text-sm text-score-dim">{t("scoring.coinTossWhoServes")}</span>
            <div className="flex gap-3">
              <PrimaryButton onClick={() => setFirstServer("A")}>
                {t("scoring.teamServes", { team: teamAName })}
              </PrimaryButton>
              <PrimaryButton onClick={() => setFirstServer("B")}>
                {t("scoring.teamServes", { team: teamBName })}
              </PrimaryButton>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-score-dim">
              {t("scoring.coinTossSide", {
                server: firstServer === "A" ? teamAName : teamBName,
                team: teamAName,
              })}
            </span>
            <div className="flex gap-3">
              <PrimaryButton onClick={() => onToss(firstServer, "LEFT")}>
                {t("scoring.left")}
              </PrimaryButton>
              <PrimaryButton onClick={() => onToss(firstServer, "RIGHT")}>
                {t("scoring.right")}
              </PrimaryButton>
            </div>
            <SecondaryButton onClick={() => setFirstServer(null)}>
              {t("scoring.back")}
            </SecondaryButton>
          </>
        )}
      </div>
    </Banner>
  );
}
