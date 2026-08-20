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
 * Swiss official time — CET in winter, CEST in summer, changing itself on the
 * last Sundays of March and October. The federation's own clock, and therefore
 * the right one for a record of when something was done to the platform.
 */
export const SWISS_TIME_ZONE = "Europe/Zurich";
/**
 * The locale pinned alongside a fixed zone. It has to be fixed too: the server
 * and the browser do not agree on a default locale, and a timestamp that
 * formats one way during SSR and another after hydration is a React mismatch,
 * not merely an inconsistency. en-GB gives day-before-month and a 24-hour
 * clock, which is what an international federation reads without ambiguity.
 */
const FIXED_LOCALE = "en-GB";

/**
 * Renders a timestamp, with the UTC time always in the tooltip.
 *
 * Two modes, and which one a page wants is a real decision rather than a
 * preference:
 *
 *  - **Without `timeZone`** (the default) it shows the VIEWER'S timezone, and
 *    server-renders UTC first because the server cannot know what that is.
 *    Right for anything happening at a venue — a match at 19:00 is at 19:00 for
 *    the person standing in the hall.
 *  - **With `timeZone`** it shows that zone and names it, identically on the
 *    server and in the browser. Right for a record of an operational event,
 *    where "when did this happen" needs ONE answer that two people in two
 *    countries can read off the same screen and agree on.
 */
export function LocalTime({
  date,
  mode = "datetime",
  timeZone,
}: {
  date: Date | string | null;
  /** `date` drops the clock — for day headers over a grouped schedule. */
  mode?: "datetime" | "time" | "date";
  /** An IANA zone to pin, e.g. `SWISS_TIME_ZONE`. Omit for the viewer's own. */
  timeZone?: string;
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

  const options: Intl.DateTimeFormatOptions = {
    ...(mode === "datetime" ? { day: "numeric", month: "short" } : {}),
    ...(mode === "date"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { hour: "2-digit", minute: "2-digit" }),
  };

  // A pinned zone renders the same everywhere, so it needs no hydration dance
  // and never flashes UTC first. The zone is NAMED on anything showing a clock:
  // "14:32" with no zone is exactly the ambiguity this mode exists to remove.
  if (timeZone) {
    return (
      <span title={utc}>
        {new Intl.DateTimeFormat(FIXED_LOCALE, {
          ...options,
          timeZone,
          ...(mode === "date" ? {} : { timeZoneName: "short" }),
        }).format(d)}
      </span>
    );
  }

  const local = hydrated
    ? new Intl.DateTimeFormat(undefined, options).format(d)
    : null;
  return <span title={utc}>{local ?? utc}</span>;
}
