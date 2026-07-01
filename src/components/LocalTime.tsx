"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
/** False during SSR/hydration, true after — avoids a server/client mismatch. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Renders a timestamp in the viewer's local timezone (with the UTC time in the
 * tooltip). Server-renders the UTC form first, then swaps after hydration.
 */
export function LocalTime({
  date,
  mode = "datetime",
}: {
  date: Date | string | null;
  mode?: "datetime" | "time";
}) {
  const hydrated = useHydrated();
  const d = typeof date === "string" ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return <>–</>;

  const utc =
    mode === "datetime"
      ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
      : `${d.toISOString().slice(11, 16)} UTC`;
  const local = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        ...(mode === "datetime" ? { day: "numeric", month: "short" } : {}),
        hour: "2-digit",
        minute: "2-digit",
      }).format(d)
    : null;

  return <span title={utc}>{local ?? utc}</span>;
}
