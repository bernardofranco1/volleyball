"use client";

/**
 * The in-app fixture index for a VIS-linked competition (spec/34), with the
 * reader's choice of clock (spec/46).
 *
 * Same clock machinery as the public board host — one storage key, one set of
 * arithmetic, in `ClockZone.tsx` — but this page's own rows: a fixed time
 * column, full team names, and no copy buttons, inside the console chrome.
 *
 * Client-rendered because the choice reshapes the day grouping and not merely
 * the labels; see `ClockZone.tsx` for the hydration strategy.
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

function StatusChip({ status }: { status: VisMatchSummary["status"] }) {
  const t = useT();
  const style =
    status === "LIVE"
      ? "border-red-400 bg-red-500/15 text-red-300"
      : status === "FINISHED"
        ? "border-border bg-surface-raised text-score-dim"
        : "border-sky-400/60 bg-sky-500/10 text-sky-300";
  const label =
    status === "LIVE"
      ? t("visBoard.statusLive")
      : status === "FINISHED"
        ? t("visBoard.statusFinal")
        : t("visBoard.statusScheduled");
  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style}`}
    >
      {label}
    </span>
  );
}

export function VisIndexDayList({
  matches,
  base,
  venueName,
}: {
  matches: VisMatchSummary[];
  /** Board links are `${base}/${matchNo}`. */
  base: string;
  /** The venue's city, when the whole event is in one. For the caption. */
  venueName?: string | null;
}) {
  const t = useT();
  const bcp47 = dateLocale(useLocale());
  const choice = useClockZone(matches);
  const { zone, readerZone, oneVenueOffset } = choice;

  const days = useMemo(
    () => groupByDay(matches, zone, readerZone),
    [matches, zone, readerZone],
  );

  // Whether ANY row needs its offset spelled out decides the width of the time
  // column for ALL of them: a per-row width would break the alignment that is
  // the whole point of having a column.
  const showOffsets =
    (zone === "venue" && !oneVenueOffset) ||
    days.some((d) => d.rows.some((r) => r.clock.fellBackToVenue));

  return (
    <>
      <ClockZoneToggle choice={choice} venueName={venueName} />

      {days.map((day) => (
        <section key={day.dayKey}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-score-dim">
            {dayHeading(day.dayKey, bcp47) ?? t("clock.dateTbc")}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {day.rows.map(({ match: m, clock }) => (
              <li key={m.matchNo}>
                <Link
                  href={`${base}/${m.matchNo}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-raised"
                >
                  <span
                    className={`${
                      showOffsets ? "w-24" : "w-12"
                    } shrink-0 font-mono text-sm tabular-nums text-score-dim`}
                  >
                    {clock.time ?? "—"}
                    {showOffsets && clock.time ? (
                      <span className="ml-1 font-sans text-[11px]">
                        {clock.fellBackToVenue
                          ? t("clock.venueTimeSuffix")
                          : (venueOffsetLabel(m) ?? "")}
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {m.teamAName} <span className="text-score-dim">v</span> {m.teamBName}
                  </span>
                  {m.resultText ? (
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {m.resultText}
                    </span>
                  ) : null}
                  <StatusChip status={m.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
