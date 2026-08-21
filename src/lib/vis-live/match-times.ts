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
 *
 * **`null` means NOT KNOWN YET, and is not the same as `"UTC"`.** That
 * distinction is the whole point of the type: a server render that treats its
 * own placeholder as a fact tells the reader their zone is Greenwich, which for
 * almost every reader is a lie. Unknown falls back to venue time, flagged, the
 * same way a fixture with no UTC instant does.
 */
export function matchClock(
  m: ScheduledPair,
  zone: ClockZone,
  readerZone: string | null,
): MatchClock {
  const venue = m.scheduledVenue ? splitNaive(m.scheduledVenue) : null;
  const utcMs = m.scheduledUtc ? Date.parse(m.scheduledUtc) : NaN;
  const hasUtc = Number.isFinite(utcMs);
  const canHonour = zone !== "local" || readerZone != null;

  // Venue time is a string, never a conversion: no zone database can disagree
  // with what VIS says the arena clock reads.
  if (zone === "venue" || !hasUtc || !canHonour) {
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
    ...partsIn(zone === "gmt" ? "UTC" : readerZone!, utcMs),
    sortMs: utcMs,
    fellBackToVenue: false,
  };
}

/**
 * Zone names that mean "no real zone": a device with its time zone unset, or a
 * browser deliberately hiding it (Tor, Firefox's resistFingerprinting, Brave's
 * fingerprint shield) reports one of these. Worth telling the reader about,
 * because "Local time" and "GMT" then show the same numbers and the page looks
 * broken rather than honest.
 *
 * Matched by NAME, not by a zero offset: a reader in `Europe/London` in
 * February is genuinely on GMT and must not be told their device is misreporting.
 */
export function isPlaceholderZone(readerZone: string | null): boolean {
  return (
    readerZone == null ||
    /^(UTC|GMT|Zulu|Universal|Etc\/(UTC|GMT|Zulu|Universal|Greenwich|GMT[+-]0))$/.test(
      readerZone,
    )
  );
}

/** `zone` when the runtime can actually format in it, else null. */
export function validZoneOrNull(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Where the resolved reader zone came from; null = an unfilled placeholder. */
export type ReaderZoneSource = "device" | "manual" | "network" | null;

export interface ReaderZone {
  zone: string | null;
  source: ReaderZoneSource;
}

/**
 * The zone "Local time" should actually use.
 *
 * The device's own setting wins whenever it is real — it is the clock the
 * reader lives by, and nothing may override a deliberate setting. When the
 * device claims UTC or nothing at all (zone unset, or a browser concealing it),
 * the reader's own explicit choice from the picker comes next, then the network
 * estimate (Vercel's `x-vercel-ip-timezone`); only with all three silent does
 * "local" honestly mean Greenwich. The manual value and the header are both
 * validated before use — both are input, and an unformattable zone name would
 * throw inside `Intl` at render time.
 */
export function resolveReaderZone(
  deviceZone: string | null,
  manualZone: string | null,
  networkZone: string | null,
): ReaderZone {
  if (!isPlaceholderZone(deviceZone)) return { zone: deviceZone, source: "device" };
  const manual = validZoneOrNull(manualZone);
  if (manual) return { zone: manual, source: "manual" };
  const network = validZoneOrNull(networkZone);
  if (network) return { zone: network, source: "network" };
  return { zone: deviceZone, source: null };
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

/**
 * The reader's own offset at a given instant, as "GMT+2"; null when their zone
 * is not known yet, because the alternative is printing "GMT" at someone in
 * Zurich.
 */
export function readerOffsetLabel(
  readerZone: string | null,
  atMs: number,
): string | null {
  if (readerZone == null) return null;
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
  readerZone: string | null,
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
