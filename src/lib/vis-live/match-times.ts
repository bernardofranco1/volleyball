/**
 * Re-zoning a VIS fixture list (spec/46).
 *
 * The board host's day index is read by three different people at once: staff
 * in the arena, a federation office three time zones away, and FIVB in
 * Lausanne. One column of "local time" serves exactly one of them, so the index
 * offers three: the reader's own zone, the venue's, and GMT.
 *
 * The trick that keeps this honest is that VIS states BOTH halves of every
 * kick-off — `DateTimeLocal` (venue wall clock, no offset) and `DateTimeUtc`
 * (the same instant). The pair IS the venue's UTC offset for that fixture, so:
 *
 *   - venue time needs no conversion at all — it is the string VIS sent;
 *   - GMT needs no zone database — it is the other string VIS sent;
 *   - the reader's own zone is one `Intl` format of the UTC instant.
 *
 * No IANA zone for the venue, no DST arithmetic, nothing to keep in sync with
 * a tzdata release. It also has to be per MATCH rather than per competition:
 * VIS tournament 1736 spans ten cities and eight distinct offsets.
 */

export type ClockZone = "local" | "venue" | "gmt";

export interface MatchClock {
  /** "14:00" in the chosen zone, or null when VIS states no kick-off. */
  time: string | null;
  /** "2026-08-21" in the chosen zone — the day-group key. */
  dayKey: string;
  /** Sort key: the kick-off instant in ms, or +∞ for a fixture with no time. */
  sortMs: number;
  /**
   * True when the chosen zone could not be honoured and venue time is shown
   * instead, because VIS gave this row no UTC instant to convert.
   */
  fellBackToVenue: boolean;
}

/** The day-group key for a fixture VIS gives no date at all. */
export const NO_DATE = "—";

/** A fixture with no venue wall time and no UTC instant. */
const UNKNOWN: MatchClock = {
  time: null,
  dayKey: NO_DATE,
  sortMs: Number.POSITIVE_INFINITY,
  fellBackToVenue: false,
};

export interface ScheduledPair {
  /** Venue wall clock, no offset: "2026-08-21T10:00:00". */
  scheduledVenue: string | null;
  /** The same instant: "2026-08-21T02:00:00Z". */
  scheduledUtc: string | null;
}

/** "2026-08-21T10:00:00" → { day, hhmm }; tolerant of a space separator. */
function splitNaive(iso: string): { dayKey: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(iso.trim());
  return m ? { dayKey: m[1], time: `${m[2]}:${m[3]}` } : null;
}

/**
 * Formatters are cached: the index formats one per row per zone, and building
 * an `Intl.DateTimeFormat` is by far the most expensive thing on this page.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(zone: string, ms: number): { dayKey: string; time: string } {
  let fmt = formatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      // h23, not hour12:false — en-GB renders midnight as "24:00" otherwise.
      hourCycle: "h23",
    });
    formatters.set(zone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(ms)) parts[p.type] = p.value;
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Where one fixture sits on the clock, in the chosen zone.
 *
 * `readerZone` is the viewer's IANA zone, needed only for `"local"`. It is
 * passed in rather than resolved here so that the server render and the tests
 * are both deterministic — the browser's zone is not knowable on the server.
 */
export function matchClock(
  m: ScheduledPair,
  zone: ClockZone,
  readerZone: string,
): MatchClock {
  const venue = m.scheduledVenue ? splitNaive(m.scheduledVenue) : null;
  const utcMs = m.scheduledUtc ? Date.parse(m.scheduledUtc) : NaN;
  const hasUtc = Number.isFinite(utcMs);

  // Venue time is a string, never a conversion: no zone database can disagree
  // with what VIS says the arena clock reads.
  if (zone === "venue" || !hasUtc) {
    if (!venue) {
      return hasUtc
        ? { ...partsIn("UTC", utcMs), sortMs: utcMs, fellBackToVenue: false }
        : UNKNOWN;
    }
    return {
      ...venue,
      sortMs: hasUtc ? utcMs : Date.parse(`${m.scheduledVenue}Z`),
      fellBackToVenue: zone !== "venue",
    };
  }

  return {
    ...partsIn(zone === "gmt" ? "UTC" : readerZone, utcMs),
    sortMs: utcMs,
    fellBackToVenue: false,
  };
}

/**
 * The venue's UTC offset for one fixture, as "GMT+8" / "GMT-3:30" / "GMT".
 * Derived from the two timestamps, so it is right across a DST boundary and
 * right for a half-hour zone; null when VIS omits either half.
 */
export function venueOffsetLabel(m: ScheduledPair): string | null {
  if (!m.scheduledVenue || !m.scheduledUtc) return null;
  const local = Date.parse(`${m.scheduledVenue.trim()}Z`);
  const utc = Date.parse(m.scheduledUtc);
  if (!Number.isFinite(local) || !Number.isFinite(utc)) return null;
  return gmtLabel(Math.round((local - utc) / 60_000));
}

/** Minutes east of UTC → "GMT+8" / "GMT-3:30" / "GMT". */
export function gmtLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "GMT";
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `GMT${sign}${h}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
}

/** The reader's own offset right now, as "GMT+2". */
export function readerOffsetLabel(readerZone: string, atMs: number): string | null {
  try {
    const { dayKey, time } = partsIn(readerZone, atMs);
    const asIfUtc = Date.parse(`${dayKey}T${time}:00Z`);
    // atMs carries seconds the formatted parts dropped; round both to the
    // minute so a 30-second remainder cannot become a 1-minute offset.
    return gmtLabel(Math.round((asIfUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000));
  } catch {
    return null;
  }
}

/**
 * "2026-08-21" → "Fri 21 Aug", in the reader's language. Rendered from the key
 * itself at midday UTC, so the heading can never drift a day away from the rows
 * it heads. Null for a fixture list with no date, which the caller labels — the
 * words belong in the message catalogue, not here.
 */
export function dayHeading(dayKey: string, bcp47 = "en-GB"): string | null {
  if (dayKey === NO_DATE) return null;
  const ms = Date.parse(`${dayKey}T12:00:00Z`);
  if (!Number.isFinite(ms)) return dayKey;
  return new Intl.DateTimeFormat(bcp47, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(ms);
}

/**
 * App locale → the tag to format dates with. `en` alone would give US
 * month-first order, which nobody at a FIVB event reads a fixture list in.
 */
export function dateLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

export interface MatchDay<T> {
  dayKey: string;
  rows: Array<{ match: T; clock: MatchClock }>;
}

const RANK = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const;

/**
 * Group fixtures into days *in the chosen zone*, days ascending, live matches
 * first within a day and then by kick-off.
 *
 * The day boundary moves with the zone — a 10:00 fixture in Tianjin is the
 * previous evening in New York — so grouping cannot be done once on the server
 * and re-labelled on the client; the whole shape depends on the choice.
 */
export function groupByDay<T extends ScheduledPair & { status: keyof typeof RANK }>(
  matches: readonly T[],
  zone: ClockZone,
  readerZone: string,
): MatchDay<T>[] {
  const days = new Map<string, MatchDay<T>["rows"]>();
  for (const match of matches) {
    const clock = matchClock(match, zone, readerZone);
    const rows = days.get(clock.dayKey);
    if (rows) rows.push({ match, clock });
    else days.set(clock.dayKey, [{ match, clock }]);
  }
  return [...days.entries()]
    // NO_DATE sorts last: "—" is not a date and belongs after the schedule.
    .sort(([a], [b]) =>
      a === NO_DATE ? 1 : b === NO_DATE ? -1 : a.localeCompare(b),
    )
    .map(([dayKey, rows]) => ({
      dayKey,
      rows: rows.sort(
        (x, y) =>
          RANK[x.match.status] - RANK[y.match.status] ||
          x.clock.sortMs - y.clock.sortMs,
      ),
    }));
}
