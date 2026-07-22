"use client";

import { formatCountdown } from "@/components/scoreboard/Countdown";
import { type TournamentConfig, setBreakSecsAfter } from "@/engine/config";

/** Minimal state shape the countdown reads (all four engines provide it). */
export interface CountdownStateLike {
  rallyPhase: string;
  activeTimeoutTeam?: "A" | "B" | null;
  activeTimeoutStartedAt?: string | null;
  setBreakStartedAt?: string | null;
  currentSetNumber: number;
}

/**
 * The active time-out / set-break countdown for a match state, or null. The
 * deadline derives from the server event timestamp so scorer, tablet and board
 * all show the same clock.
 */
export function activeCountdown(
  state: CountdownStateLike,
  config: TournamentConfig,
): { kind: "TIMEOUT" | "SET_BREAK"; deadlineMs: number; team: "A" | "B" | null } | null {
  if (state.rallyPhase === "TIMEOUT_ACTIVE" && state.activeTimeoutStartedAt)
    return {
      kind: "TIMEOUT",
      deadlineMs:
        Date.parse(state.activeTimeoutStartedAt) + config.timeoutDurationSecs * 1000,
      team: state.activeTimeoutTeam ?? null,
    };
  if (state.rallyPhase === "SET_BREAK" && state.setBreakStartedAt)
    return {
      kind: "SET_BREAK",
      deadlineMs:
        Date.parse(state.setBreakStartedAt) +
        setBreakSecsAfter(config, state.currentSetNumber) * 1000,
      team: null,
    };
  return null;
}

/**
 * Non-blocking countdown card floating over the court zone. Replaces the old
 * full-screen dim+blur blocker, which hid the score/court on every surface for
 * the whole time-out and trapped the tablet's request buttons: the wrapper
 * ignores ALL pointer events (taps pass through), so everything around the
 * card stays legible and operable. Used by the scorer console, team tablets
 * and the public scoreboard so all three show the same floating clock; on the
 * scorer the controls live in the bottom action-bar banner, never in the card.
 *
 * The accent border carries WHO called it (calling team's colour for a team
 * time-out; theme primary for set breaks). The digits pulse over the final
 * five seconds (stilled under prefers-reduced-motion).
 */
export function FloatingCountdown({
  title,
  subtitle,
  ms,
  accent = "var(--primary)",
  className = "top-[38%]",
}: {
  title: string;
  subtitle?: string;
  ms: number;
  accent?: string;
  /** Vertical anchor of the card (Tailwind positioning classes). Defaults to
   *  mid-board for TVs; the scorer console passes a court-zone anchor. */
  className?: string;
}) {
  const urgent = ms > 0 && ms <= 5000;
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[70] flex justify-center ${className}`}
      role="timer"
      aria-label={title}
    >
      <div
        className="flex flex-col items-center gap-1 rounded-2xl border-2 bg-surface-raised/90 px-8 py-4 text-center shadow-2xl backdrop-blur"
        style={{ borderColor: accent }}
      >
        <div className="text-xs uppercase tracking-[0.3em] text-score-dim">
          {title}
        </div>
        {subtitle ? (
          <div className="text-sm font-medium text-foreground">{subtitle}</div>
        ) : null}
        <div
          className={`font-mono text-5xl font-bold tabular-nums sm:text-6xl ${
            urgent ? "animate-pulse text-red-300 motion-reduce:animate-none" : ""
          }`}
        >
          {formatCountdown(ms)}
        </div>
      </div>
    </div>
  );
}
