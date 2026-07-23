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
import { resolveTeamColor } from "@/lib/colors";
import { useT } from "@/lib/i18n/client";
import { Banner, PrimaryButton, SecondaryButton } from "./buttons";
import { FloatingCountdown } from "./CountdownOverlay";
import { ShortcutAction } from "./shortcuts-context";
import { useArmedConfirm } from "./useArmedConfirm";

// Overdue-countdown grace: a deadline more than this far in the past never
// auto-fires and renders as an inline banner instead of the blocking overlay.
const AUTOFIRE_GRACE_MS = 10_000;

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
    | { type: "UNDO"; targetEventId: string; scope?: "single" | "point" },
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
  /** A post is in flight — disables the Undo buttons so impatient re-taps
   * can't queue extra undos (each would remove one more scorer action). */
  pending?: boolean;
  /** Team colours — the floating time-out clock borrows the calling team's. */
  teamAColor?: string | null;
  teamBColor?: string | null;
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
  pending = false,
  teamAColor = null,
  teamBColor = null,
  lineupPendingText,
  extraPhase,
}: PrePhaseOptions): React.ReactElement | null {
  const t = useT();
  // Side chosen for team A at the coin toss; consumed by the set-1 start banner.
  const [tossSide, setTossSide] = useState<Side>("LEFT");
  // Every banner Undo is two-tap armed: undoing here reopens a finished set or
  // removes an interruption, and single-tap buttons let impatient re-taps on a
  // slow connection silently unwind extra actions.
  const { armed, tapConfirm } = useArmedConfirm();
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);
  const nextSide = nextSetStartSide ?? ((prev: PhaseSet) => oppositeSide(prev.teamAStartSide));

  // Undo the last scorer action — reachable even under the countdown overlays,
  // so a mis-tapped time-out (or the point that ended a set) can be reverted.
  // scope "point": the server sweeps set-start bookkeeping (SET_START /
  // SERVICE_ORDER / LINEUP_CONFIRMED) and the last real action in ONE batch,
  // so "undo the set-winning point" is one confirmed tap even after the next
  // set auto-started. The server resolves the target; "" is the placeholder.
  const undo = () =>
    dispatch({ type: "UNDO", targetEventId: "", scope: "point" });
  // Keyboard path for banner undos — same two-tap arming as the button.
  const undoShortcut = () => tapConfirm("UNDO", undo);
  const undoButton = (label: string, confirmLabel: string) => (
    <SecondaryButton
      armed={armed === "UNDO"}
      disabled={pending}
      onClick={() => tapConfirm("UNDO", undo)}
    >
      {armed === "UNDO" ? confirmLabel : label}
    </SecondaryButton>
  );

  // Advance to the next set (shared by the manual button and the auto-advance
  // timer): opposite first-server, side per the discipline's rule. Guarded
  // against starting a set beyond bestOf — a rewind that erases MATCH_END can
  // leave the FINAL set parked in SET_BREAK with a long-past deadline, and an
  // unguarded auto-advance would fabricate a phantom extra set. The DECIDING
  // set never auto-starts either: FIVB rules call for a new coin toss before
  // it, so the set-break banner shows the re-toss instead (DecidingSetToss).
  const startNextSet = () => {
    if (!set) return;
    const nextSetNumber = state.currentSetNumber + 1;
    if (config && nextSetNumber >= config.bestOf) return;
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

  // A countdown whose deadline is LONG past is not a live interruption — the
  // scorer only lands on one via an Undo that stepped back into it (or a very
  // late reload). Rendering the blocking 0:00 overlay there reads as a dead
  // end, so those fall through to the inline banners (which carry Undo too),
  // keeping the console usable while stepping back through a finished set.
  // Staleness = a grace-shifted countdown that has itself run out (keeps the
  // clock reads inside the countdown hook — render stays pure).
  const setBreakGraceMs = useCountdown(
    setBreakDeadline != null ? setBreakDeadline + AUTOFIRE_GRACE_MS : null,
  );
  const timeoutGraceMs = useCountdown(
    timeoutDeadline != null ? timeoutDeadline + AUTOFIRE_GRACE_MS : null,
  );
  const setBreakStale = setBreakDeadline != null && setBreakGraceMs <= 0;
  const timeoutStale = timeoutDeadline != null && timeoutGraceMs <= 0;

  // Auto-fire at the DEADLINE via absolute-time timers — deliberately not
  // derived from the display countdown's tick state (which reports a stale 0
  // for one frame when a fresh deadline appears; acting on that would end a
  // time-out the instant it started). A slightly-overdue deadline still fires
  // (scorer loads just as a time-out runs out), but a LONG-expired one never
  // does: the only ways to be parked on one are an Undo that stepped back into
  // it or a late (re)load, and auto-firing there re-consumed the state the
  // scorer had just undone, making Undo appear dead. The overlay's manual
  // buttons (End time-out / Start next set / Undo) stay available instead.
  // `firedRef` dedupes per countdown instance across re-renders.
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!timeoutDeadline) return;
    if (Date.now() - timeoutDeadline > AUTOFIRE_GRACE_MS) return;
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
    if (Date.now() - setBreakDeadline > AUTOFIRE_GRACE_MS) return;
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
          <ShortcutAction id="undo" run={undoShortcut} />
          <span>
            🏆{" "}
            {t("scoring.matchWon", {
              team: name(state.winner ?? "A"),
              setsA: state.setsWonA,
              setsB: state.setsWonB,
            })}
          </span>
          {undoButton(
            t("scoring.undoLastPoint"),
            t("scoring.confirmUndoPoint", { set: state.currentSetNumber }),
          )}
        </div>
      </Banner>
    );

  if (state.rallyPhase === "SET_BREAK") {
    // A live countdown floats over the court (non-blocking; auto-advance still
    // fires at 0:00) while the controls stay in the bottom banner — the score
    // strip and court remain legible. No clock once the deadline is long past
    // (Undo stepped back into the break) or in the beyond-bestOf rewind edge.
    const showClock =
      setBreakDeadline != null &&
      !setBreakStale &&
      config != null &&
      state.currentSetNumber < config.bestOf;
    // FIVB rules: the deciding set gets a NEW coin toss — never auto-started,
    // and the manual button is replaced by the two-step re-toss.
    const nextIsDecider =
      config != null && state.currentSetNumber + 1 === config.bestOf;
    return (
      <>
        {showClock ? (
          <FloatingCountdown
            title={t("scoring.setBreak")}
            ms={setBreakMs}
            className="top-[34%]"
          />
        ) : null}
        <Banner>
          <div className="flex flex-col items-center gap-3">
            {!nextIsDecider ? (
              <ShortcutAction id="advance" run={startNextSet} />
            ) : null}
            <ShortcutAction id="undo" run={undoShortcut} />
            <span>
              {t("scoring.setEnded", {
                set: set?.setNumber ?? "",
                setsA: state.setsWonA,
                setsB: state.setsWonB,
              })}
            </span>
            {nextIsDecider ? (
              <DecidingSetToss
                teamAName={teamAName}
                teamBName={teamBName}
                disabled={nextSetDisabled}
                onStart={(firstServer, teamAStartSide) =>
                  dispatch({
                    type: "SET_START",
                    setNumber: state.currentSetNumber + 1,
                    firstServer,
                    teamAStartSide,
                  })
                }
              />
            ) : null}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {!nextIsDecider ? (
                <PrimaryButton disabled={nextSetDisabled} onClick={startNextSet}>
                  {t("scoring.startNextSet")}
                </PrimaryButton>
              ) : null}
              {undoButton(
                t("scoring.undo"),
                t("scoring.confirmUndoPoint", { set: state.currentSetNumber }),
              )}
            </div>
          </div>
        </Banner>
      </>
    );
  }

  if (state.rallyPhase === "TIMEOUT_ACTIVE") {
    const to = state.activeTimeoutTeam ?? "A";
    // Passive clock over the court in the calling team's colour; End/Undo stay
    // in the bottom banner (thumb zone). Auto-end still fires at 0:00.
    const showClock = timeoutDeadline != null && !timeoutStale;
    return (
      <>
        {showClock ? (
          <FloatingCountdown
            title={`${name(to)} · ${t("scoring.timeoutLabel")}`}
            ms={timeoutMs}
            accent={resolveTeamColor(to === "A" ? teamAColor : teamBColor, to)}
            className="top-[34%]"
          />
        ) : null}
        <Banner>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ShortcutAction id="advance" run={() => dispatch({ type: "TIMEOUT_END", team: to })} />
            <ShortcutAction id="undo" run={undoShortcut} />
            <PrimaryButton onClick={() => dispatch({ type: "TIMEOUT_END", team: to })}>
              {t("scoring.endTimeout", { team: name(to) })}
            </PrimaryButton>
            {undoButton(t("scoring.undo"), t("scoring.confirmUndo"))}
          </div>
        </Banner>
      </>
    );
  }

  if (extraPhase) return extraPhase;

  if (state.rallyPhase === "MEDICAL_TIMEOUT_ACTIVE")
    return (
      <Banner>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ShortcutAction id="advance" run={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })} />
          <ShortcutAction id="undo" run={undoShortcut} />
          <PrimaryButton onClick={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })}>
            {t("scoring.endMedicalTimeout")}
          </PrimaryButton>
          {undoButton(t("scoring.undo"), t("scoring.confirmUndo"))}
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
        <ShortcutAction id="advance" run={() => dispatch({ type: "MATCH_CREATED", matchId: state.matchId })} />
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
        <ShortcutAction id="advance" run={() => dispatch({ type: "MATCH_START" })} />
        <PrimaryButton onClick={() => dispatch({ type: "MATCH_START" })}>
          {t("scoring.startMatch")}
        </PrimaryButton>
      </Banner>
    );

  // status LIVE but no active (unfinished) set yet → start the set. Set 1 uses
  // the side chosen at the coin toss; later sets derive from the previous set.
  // The deciding set (reachable here via rewind/undo edges) re-tosses instead.
  if (!set || set.winner) {
    if (config && state.currentSetNumber === config.bestOf)
      return (
        <Banner>
          <DecidingSetToss
            teamAName={teamAName}
            teamBName={teamBName}
            disabled={nextSetDisabled}
            onStart={(firstServer, teamAStartSide) =>
              dispatch({
                type: "SET_START",
                setNumber: state.currentSetNumber,
                firstServer,
                teamAStartSide,
              })
            }
          />
        </Banner>
      );
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

// ── deciding-set re-toss ─────────────────────────────────────────────────────

/**
 * Two-step re-toss shown before the deciding set (FIVB: a NEW coin toss
 * decides first service and sides — the platform used to auto-alternate).
 * Same interaction as the match coin toss: who serves, then team A's side.
 */
function DecidingSetToss({
  teamAName,
  teamBName,
  disabled,
  onStart,
}: {
  teamAName: string;
  teamBName: string;
  disabled?: boolean;
  onStart: (firstServer: TeamId, teamAStartSide: Side) => void;
}) {
  const t = useT();
  const [firstServer, setFirstServer] = useState<TeamId | null>(null);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-score-dim">
        {t("scoring.deciderToss")}
      </span>
      {firstServer === null ? (
        <>
          <span className="text-sm text-score-dim">{t("scoring.coinTossWhoServes")}</span>
          <div className="flex flex-wrap justify-center gap-2">
            <PrimaryButton disabled={disabled} onClick={() => setFirstServer("A")}>
              {t("scoring.teamServes", { team: teamAName })}
            </PrimaryButton>
            <PrimaryButton disabled={disabled} onClick={() => setFirstServer("B")}>
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
          <div className="flex flex-wrap justify-center gap-2">
            <PrimaryButton disabled={disabled} onClick={() => onStart(firstServer, "LEFT")}>
              {t("scoring.left")}
            </PrimaryButton>
            <PrimaryButton disabled={disabled} onClick={() => onStart(firstServer, "RIGHT")}>
              {t("scoring.right")}
            </PrimaryButton>
          </div>
          <SecondaryButton onClick={() => setFirstServer(null)}>
            {t("scoring.back")}
          </SecondaryButton>
        </>
      )}
    </div>
  );
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
