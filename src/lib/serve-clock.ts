"use client";

import { useEffect, useState } from "react";

/**
 * Countdown hook for the serve clock. Given an absolute `deadline` (epoch ms,
 * or null when no clock is running), returns the whole seconds remaining and a
 * 0..1 fraction for rendering a progress bar. Ticks ~10×/s for a smooth bar.
 */
export function useServeClock(
  deadline: number | null,
  totalSecs: number,
): { remainingSecs: number; fraction: number; running: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline == null) {
    return { remainingSecs: 0, fraction: 0, running: false };
  }

  const remainingMs = Math.max(0, deadline - now);
  const remainingSecs = Math.ceil(remainingMs / 1000);
  const fraction = totalSecs > 0 ? remainingMs / (totalSecs * 1000) : 0;
  return {
    remainingSecs,
    fraction: Math.max(0, Math.min(1, fraction)),
    running: remainingMs > 0,
  };
}
