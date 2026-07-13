"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Counts down to an absolute deadline (epoch ms). Returns remaining ms, ticking
 * ~4×/sec. The tick is a useCallback scheduled via timers (never a synchronous
 * setState in the effect body); Date.now() lives only inside the tick. When
 * `deadline` is null the hook reports 0.
 *
 * NOTE: `remaining` is 0 until the first (0 ms) tick commits — display-only
 * consumers tolerate the one-frame lag, but anything that must ACT when a
 * countdown expires (auto TIMEOUT_END / auto next set) must schedule its own
 * absolute-time timer instead of watching this value hit 0.
 */
export function useCountdown(deadline: number | null): number {
  const [remaining, setRemaining] = useState(0);
  const tick = useCallback(() => {
    if (deadline) setRemaining(Math.max(0, deadline - Date.now()));
  }, [deadline]);
  useEffect(() => {
    if (!deadline) return;
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline, tick]);
  return deadline ? remaining : 0;
}

/** Format remaining ms as M:SS (or H:MM:SS past an hour). */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
