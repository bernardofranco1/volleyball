"use client";

import { useServeClock } from "@/lib/serve-clock";

// Serve-clock countdown bar. Renders nothing until a deadline is set; turns red
// in the final second.
export function ServeClockWidget({
  deadline,
  totalSecs,
}: {
  deadline: number | null;
  totalSecs: number;
}) {
  const { remainingSecs, fraction, running } = useServeClock(deadline, totalSecs);
  if (deadline == null || !running) return null;

  const danger = remainingSecs <= 1;
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <span className="text-xs uppercase tracking-wide text-score-dim">
        Serve
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${
            danger ? "bg-red-500" : "bg-primary"
          }`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`w-8 text-right font-mono text-sm tabular-nums ${
          danger ? "text-red-400" : "text-score-active"
        }`}
      >
        {remainingSecs}s
      </span>
    </div>
  );
}
