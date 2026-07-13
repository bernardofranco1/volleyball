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
 * Full-screen, semi-transparent blocker with a centred countdown square. The
 * backdrop captures pointer events, so every control beneath is effectively
 * disabled while a time-out / set break is counting down (brief request). Used
 * on the scorer console, team tablets and the public scoreboard so all three
 * show the same floating countdown.
 */
export function CountdownOverlay({
  title,
  subtitle,
  ms,
  accent = "var(--primary)",
  action,
}: {
  title: string;
  subtitle?: string;
  ms: number;
  accent?: string;
  /** Optional control INSIDE the square (scorer-only escape hatch, e.g. "Resume
   *  now"). Display surfaces (tablet, board) omit it. */
  action?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="alertdialog"
      aria-label={title}
    >
      <div
        className="flex min-w-[min(70vw,20rem)] flex-col items-center gap-2 rounded-3xl border-2 bg-surface-raised/95 px-10 py-8 text-center shadow-2xl"
        style={{ borderColor: accent }}
      >
        <div className="text-xs uppercase tracking-[0.3em] text-score-dim">
          {title}
        </div>
        {subtitle ? (
          <div className="text-sm font-medium text-foreground">{subtitle}</div>
        ) : null}
        <div className="font-mono text-6xl font-bold tabular-nums">
          {formatCountdown(ms)}
        </div>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
