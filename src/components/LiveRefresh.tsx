"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Auto-refreshes a server-rendered page while something on it is live —
 * `router.refresh()` re-runs the RSC payload without losing scroll/filters.
 * Pauses when the tab is hidden.
 */
export function LiveRefresh({
  active,
  intervalMs = 20000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
