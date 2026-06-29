"use client";

import { useCountdown, formatCountdown } from "@/components/scoreboard/Countdown";

/**
 * Pre-match countdown to the scheduled start time (brief §4.4), shown on the
 * scorer page. Fixed banner; hides once the scheduled time is reached.
 */
export function PreMatchCountdownOverlay({
  scheduledAtMs,
}: {
  scheduledAtMs: number | null;
}) {
  const remaining = useCountdown(scheduledAtMs);
  if (!scheduledAtMs || remaining <= 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-surface-raised/95 px-5 py-2 text-center shadow-lg backdrop-blur">
      <span className="text-xs uppercase tracking-widest text-score-dim">
        Starts in{" "}
      </span>
      <span className="font-mono text-lg font-bold tabular-nums">
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}
