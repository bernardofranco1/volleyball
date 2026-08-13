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
  /** `date` drops the clock — for day headers over a grouped schedule. */
  mode?: "datetime" | "time" | "date";
}) {
  const hydrated = useHydrated();
  const d = typeof date === "string" ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return <>–</>;

  const utc =
    mode === "datetime"
      ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
      : mode === "date"
        ? d.toISOString().slice(0, 10)
        : `${d.toISOString().slice(11, 16)} UTC`;
  const local = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        ...(mode === "datetime" ? { day: "numeric", month: "short" } : {}),
        ...(mode === "date"
          ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
          : { hour: "2-digit", minute: "2-digit" }),
      }).format(d)
    : null;

  return <span title={utc}>{local ?? utc}</span>;
}
