"use client";

// Pre-live phase state machine shared by all four discipline action bars:
// FINISHED / SET_BREAK / TIMEOUT_ACTIVE / MEDICAL_TIMEOUT_ACTIVE /
// LINEUP_PENDING / SETUP / COIN_TOSS / READY / start-set banners.
// Discipline-specific interstitials (beach TTO, indoor VCS) plug in via
// `extraPhase`; the live scoring UI stays in each bar.
import { useState } from "react";
import { oppositeSide, oppositeTeam, type Side, type TeamId } from "@/engine/types";
import { useT } from "@/lib/i18n/client";
import { Banner, PrimaryButton, SecondaryButton } from "./buttons";

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
    | { type: "MEDICAL_TIMEOUT_END" },
) => void;

export interface PrePhaseOptions {
  state: PhaseMatchState;
  set: PhaseSet | undefined;
  dispatch: PhaseDispatch;
  teamAName: string;
  teamBName: string;
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
  nextSetStartSide,
  nextSetDisabled,
  lineupPendingText,
  extraPhase,
}: PrePhaseOptions): React.ReactElement | null {
  const t = useT();
  // Side chosen for team A at the coin toss; consumed by the set-1 start banner.
  const [tossSide, setTossSide] = useState<Side>("LEFT");
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);
  const nextSide = nextSetStartSide ?? ((prev: PhaseSet) => oppositeSide(prev.teamAStartSide));

  if (state.status === "FINISHED")
    return (
      <Banner>
        🏆{" "}
        {t("scoring.matchWon", {
          team: name(state.winner ?? "A"),
          setsA: state.setsWonA,
          setsB: state.setsWonB,
        })}
      </Banner>
    );

  if (state.rallyPhase === "SET_BREAK")
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
          <PrimaryButton
            disabled={nextSetDisabled}
            onClick={() => {
              if (!set) return;
              const nextSetNumber = state.currentSetNumber + 1;
              dispatch({
                type: "SET_START",
                setNumber: nextSetNumber,
                firstServer: oppositeTeam(set.firstServer),
                teamAStartSide: nextSide(set, nextSetNumber),
              });
            }}
          >
            {t("scoring.startNextSet")}
          </PrimaryButton>
        </div>
      </Banner>
    );

  if (state.rallyPhase === "TIMEOUT_ACTIVE")
    return (
      <Banner>
        <PrimaryButton
          onClick={() =>
            dispatch({ type: "TIMEOUT_END", team: state.activeTimeoutTeam ?? "A" })
          }
        >
          {t("scoring.endTimeout", { team: name(state.activeTimeoutTeam ?? "A") })}
        </PrimaryButton>
      </Banner>
    );

  if (extraPhase) return extraPhase;

  if (state.rallyPhase === "MEDICAL_TIMEOUT_ACTIVE")
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })}>
          {t("scoring.endMedicalTimeout")}
        </PrimaryButton>
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
