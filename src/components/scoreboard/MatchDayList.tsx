"use client";

/**
 * The public board host's day index, with the reader's choice of clock
 * (spec/46). The choice itself lives in `ClockZone.tsx`; this file is the
 * board-host presentation of it.
 *
 * The list is a client component because the CHOICE reshapes it: a day boundary
 * moves with the zone, so the grouping — not just the labels — depends on which
 * of the three buttons is pressed. Grouping on the server and re-labelling here
 * would file a 10:00 Tianjin fixture under the wrong heading for every reader
 * west of the venue.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useT } from "@/lib/i18n/client";
import type { VisMatchSummary } from "@/lib/vis-live/board-data";
import {
  dateLocale,
  dayHeading,
  groupByDay,
  venueOffsetLabel,
} from "@/lib/vis-live/match-times";
import { ClockZoneToggle, useClockZone } from "@/components/scoreboard/ClockZone";
import { MatchLinkRow } from "@/components/scoreboard/MatchLinkRow";

/**
 * Every match gets a tag, not just the live ones (spec/38): a row with no tag
 * reads as "no information" rather than "scheduled", and the three states have
 * to be tellable apart at a glance on a list of forty-six fixtures.
 */
function StatusTag({ status }: { status: VisMatchSummary["status"] }) {
  const t = useT();
  const style =
    status === "LIVE"
      ? "bg-danger text-white"
      : status === "FINISHED"
        ? "border border-border text-score-dim"
        : "border border-border text-foreground";
  const label =
    status === "LIVE"
      ? t("visBoard.statusLive")
      : status === "FINISHED"
        ? t("visBoard.statusFinal")
        : t("visBoard.statusScheduled");
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style}`}
    >
      {label}
    </span>
  );
}

export function MatchDayList({
  matches,
  venueName,
  networkZone,
}: {
  matches: VisMatchSummary[];
  /** The venue's city, when the whole event is in one. For the caption. */
  venueName?: string | null;
  /** Vercel's zone estimate for the connection; see `useClockZone`. */
  networkZone?: string | null;
}) {
  const t = useT();
  const bcp47 = dateLocale(useLocale());
  const choice = useClockZone(matches, networkZone);
  const { zone, readerZone, oneVenueOffset } = choice;

  const days = useMemo(
    () => groupByDay(matches, zone, readerZone),
    [matches, zone, readerZone],
  );

  return (
    <>
      <ClockZoneToggle choice={choice} venueName={venueName} className="mt-6" />

      {days.map((day) => (
        <section key={day.dayKey} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-score-dim">
            {dayHeading(day.dayKey, bcp47) ?? t("clock.dateTbc")}
          </h2>
          <ul className="mt-3 grid gap-2">
            {day.rows.map(({ match: m, clock }) => (
              <li
                key={m.matchNo}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <Link href={`/m/${m.matchNo}`} className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.teamACode || m.teamAName} v {m.teamBCode || m.teamBName}
                  </span>
                  <span className="mt-0.5 block text-xs text-score-dim">
                    {[
                      // A row VIS states no UTC instant for cannot be re-zoned;
                      // and in venue mode across several venues the hour alone
                      // is ambiguous. Both get the offset spelled out.
                      clock.fellBackToVenue
                        ? `${clock.time} ${t("clock.venueTimeSuffix")}`
                        : clock.time && zone === "venue" && !oneVenueOffset
                          ? `${clock.time} ${venueOffsetLabel(m) ?? ""}`.trim()
                          : clock.time,
                      m.hall,
                      `#${m.matchNo}`,
                      m.setsText || m.resultText,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
                <span className="flex items-center gap-3">
                  <StatusTag status={m.status} />
                  <MatchLinkRow matchNo={m.matchNo} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
