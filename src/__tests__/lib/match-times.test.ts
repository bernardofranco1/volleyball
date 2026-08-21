/**
 * Re-zoning the fixture list (spec/46).
 *
 * The rules pinned here are the ones that would put a wrong day or a wrong hour
 * on a page competition staff plan their travel around:
 *   - venue time is VIS's own string, never a conversion;
 *   - the day GROUPING moves with the zone, not just the label;
 *   - the venue's offset is derived from the two timestamps, so a half-hour
 *     zone and a DST boundary both come out right with no tz database;
 *   - a fixture VIS gives no UTC instant for degrades to venue time and says so.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapVolleyMatchList } from "@/lib/vis-live/board-data";
import {
  NO_DATE,
  dateLocale,
  dayHeading,
  gmtLabel,
  groupByDay,
  isPlaceholderZone,
  matchClock,
  readerOffsetLabel,
  venueOffsetLabel,
} from "@/lib/vis-live/match-times";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/vis/${name}.xml`, import.meta.url), "utf-8");

/** AVC Women's Asian Championship 2026 in Tianjin (GMT+8), captured 2026-08-21. */
const AVC = mapVolleyMatchList(fixture("volley-match-list-1766"));
/** The 2026-08-19 capture of tournament 1670, whose Fields predate spec/46. */
const OLD_CAPTURE = mapVolleyMatchList(fixture("volley-match-list-1670"));

describe("the fixture list carries both halves of every kick-off", () => {
  it("maps DateTimeLocal and DateTimeUtc off the wire", () => {
    expect(AVC[0]).toMatchObject({
      matchNo: 28803,
      scheduledVenue: "2026-08-21T10:00:00",
      scheduledUtc: "2026-08-21T02:00:00Z",
      city: "Tianjin",
    });
  });

  it("has a UTC instant for every fixture — the whole feature rests on it", () => {
    expect(AVC.filter((m) => !m.scheduledUtc)).toEqual([]);
  });

  it("stitches the date+time pair when a capture predates the UTC field", () => {
    // Nothing may crash on an older Fields list, or on a cached payload from
    // before the deploy: venue time still works, GMT falls back to it.
    expect(OLD_CAPTURE[0].scheduledUtc).toBeNull();
    expect(OLD_CAPTURE[0].scheduledVenue).toBe("2026-08-19T11:00:00");
  });
});

describe("matchClock", () => {
  const m = { scheduledVenue: "2026-08-21T10:00:00", scheduledUtc: "2026-08-21T02:00:00Z" };

  it("shows venue time as VIS states it, with no conversion at all", () => {
    expect(matchClock(m, "venue", "America/New_York")).toMatchObject({
      time: "10:00",
      dayKey: "2026-08-21",
      fellBackToVenue: false,
    });
  });

  it("shows GMT from the UTC instant", () => {
    expect(matchClock(m, "gmt", "America/New_York")).toMatchObject({
      time: "02:00",
      dayKey: "2026-08-21",
    });
  });

  it("shows the reader's own zone — and crosses the day line to do it", () => {
    // 10:00 in Tianjin is the PREVIOUS evening in New York. A label-only
    // conversion would leave this row under the 21st.
    expect(matchClock(m, "local", "America/New_York")).toMatchObject({
      time: "22:00",
      dayKey: "2026-08-20",
    });
  });

  it("renders midnight as 00:00, not 24:00", () => {
    const midnight = {
      scheduledVenue: "2026-08-22T00:00:00",
      scheduledUtc: "2026-08-21T22:00:00Z",
    };
    expect(matchClock(midnight, "local", "Europe/Berlin").time).toBe("00:00");
  });

  it("falls back to venue time, flagged, when VIS gives no UTC instant", () => {
    const noUtc = { scheduledVenue: "2026-08-19T11:00:00", scheduledUtc: null };
    expect(matchClock(noUtc, "local", "America/New_York")).toMatchObject({
      time: "11:00",
      dayKey: "2026-08-19",
      fellBackToVenue: true,
    });
    // Venue time was never a conversion, so asking for it is not a fallback.
    expect(matchClock(noUtc, "venue", "UTC").fellBackToVenue).toBe(false);
  });

  it("parks a fixture with no kick-off at all under its own heading, last", () => {
    const clock = matchClock({ scheduledVenue: null, scheduledUtc: null }, "local", "UTC");
    expect(clock.time).toBeNull();
    expect(clock.dayKey).toBe(NO_DATE);
    expect(clock.sortMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("an unknown reader zone is not UTC", () => {
  // The bug this pins, seen in production on 2026-08-21: the server cannot know
  // the reader's zone, used "UTC" as its placeholder, and so labelled the
  // Local-time button "GMT" for a reader in Zurich. Unknown must stay unknown.
  const m = { scheduledVenue: "2026-08-21T10:00:00", scheduledUtc: "2026-08-21T02:00:00Z" };

  it("states no offset at all rather than claiming Greenwich", () => {
    expect(readerOffsetLabel(null, Date.parse("2026-08-21T02:00:00Z"))).toBeNull();
  });

  it("falls back to venue time, flagged, instead of rendering a guess", () => {
    expect(matchClock(m, "local", null)).toMatchObject({
      time: "10:00",
      dayKey: "2026-08-21",
      fellBackToVenue: true,
    });
    // The other two choices need no reader zone, so they are unaffected.
    expect(matchClock(m, "venue", null).time).toBe("10:00");
    expect(matchClock(m, "gmt", null)).toMatchObject({
      time: "02:00",
      fellBackToVenue: false,
    });
  });

  it("groups on venue days while the zone is unknown", () => {
    const rows = [{ ...m, status: "UPCOMING" as const }];
    expect(groupByDay(rows, "local", null)[0].dayKey).toBe("2026-08-21");
  });

  it("recognises a device that reports no real zone — by name, not by offset", () => {
    for (const z of [null, "UTC", "GMT", "Etc/UTC", "Etc/GMT", "Etc/Greenwich", "Zulu"]) {
      expect(isPlaceholderZone(z)).toBe(true);
    }
    // A reader in London in February really is on GMT and must not be told
    // their device is misreporting.
    for (const z of ["Europe/London", "Africa/Abidjan", "Europe/Zurich"]) {
      expect(isPlaceholderZone(z)).toBe(false);
    }
  });
});

describe("venueOffsetLabel", () => {
  it("derives the venue's offset from the pair of timestamps", () => {
    expect(venueOffsetLabel(AVC[0])).toBe("GMT+8");
  });

  it("handles half-hour zones and the west side of Greenwich", () => {
    expect(
      venueOffsetLabel({
        scheduledVenue: "2026-08-21T20:00:00",
        scheduledUtc: "2026-08-21T14:30:00Z",
      }),
    ).toBe("GMT+5:30");
    expect(
      venueOffsetLabel({
        scheduledVenue: "2026-08-21T09:00:00",
        scheduledUtc: "2026-08-21T12:00:00Z",
      }),
    ).toBe("GMT-3");
  });

  it("is null when either half is missing", () => {
    expect(venueOffsetLabel({ scheduledVenue: "2026-08-21T10:00:00", scheduledUtc: null }))
      .toBeNull();
  });

  it("labels Greenwich itself without a sign", () => {
    expect(gmtLabel(0)).toBe("GMT");
  });
});

describe("readerOffsetLabel", () => {
  it("reads the zone's offset at that moment, DST included", () => {
    const july = Date.parse("2026-07-01T12:00:00Z");
    const january = Date.parse("2026-01-01T12:00:00Z");
    expect(readerOffsetLabel("Europe/Zurich", july)).toBe("GMT+2");
    expect(readerOffsetLabel("Europe/Zurich", january)).toBe("GMT+1");
    expect(readerOffsetLabel("Asia/Shanghai", july)).toBe("GMT+8");
    expect(readerOffsetLabel("UTC", july)).toBe("GMT");
  });

  it("survives a zone the browser cannot resolve", () => {
    expect(readerOffsetLabel("Not/AZone", Date.now())).toBeNull();
  });
});

describe("groupByDay", () => {
  it("groups the AVC schedule into venue days, ascending", () => {
    const days = groupByDay(AVC, "venue", "UTC");
    expect(days.map((d) => d.dayKey)).toEqual([...days.map((d) => d.dayKey)].sort());
    expect(days[0].dayKey).toBe("2026-08-21");
    expect(days.reduce((n, d) => n + d.rows.length, 0)).toBe(AVC.length);
  });

  it("reshapes the days when the reader is west of the venue", () => {
    const venue = groupByDay(AVC, "venue", "UTC");
    const newYork = groupByDay(AVC, "local", "America/New_York");
    // Same fixtures, different day boundaries: Tianjin's morning sessions land
    // on the previous New York date, so the first heading moves back a day.
    expect(newYork.reduce((n, d) => n + d.rows.length, 0)).toBe(AVC.length);
    expect(newYork[0].dayKey).toBe("2026-08-20");
    expect(newYork[0].dayKey < venue[0].dayKey).toBe(true);
  });

  it("puts live matches first inside a day, then orders by kick-off", () => {
    const rows = [
      { scheduledVenue: "2026-08-21T18:30:00", scheduledUtc: "2026-08-21T10:30:00Z", status: "UPCOMING" as const },
      { scheduledVenue: "2026-08-21T14:00:00", scheduledUtc: "2026-08-21T06:00:00Z", status: "LIVE" as const },
      { scheduledVenue: "2026-08-21T10:00:00", scheduledUtc: "2026-08-21T02:00:00Z", status: "FINISHED" as const },
    ];
    expect(groupByDay(rows, "venue", "UTC")[0].rows.map((r) => r.match.status)).toEqual([
      "LIVE",
      "UPCOMING",
      "FINISHED",
    ]);
  });

  it("sorts a dateless fixture last, under its own heading", () => {
    const rows = [
      { scheduledVenue: null, scheduledUtc: null, status: "UPCOMING" as const },
      { scheduledVenue: "2026-08-21T10:00:00", scheduledUtc: "2026-08-21T02:00:00Z", status: "UPCOMING" as const },
    ];
    const days = groupByDay(rows, "venue", "UTC");
    expect(days.map((d) => d.dayKey)).toEqual(["2026-08-21", NO_DATE]);
  });
});

describe("dayHeading", () => {
  it("reads the key at midday UTC, so the heading cannot drift a day", () => {
    expect(dayHeading("2026-08-21", "en-GB")).toBe("Fri 21 Aug");
  });

  it("renders in the reader's language, day before month", () => {
    // `en` alone would give "Fri, Aug 21", which is not how a fixture list is
    // read at a FIVB event.
    expect(dateLocale("en")).toBe("en-GB");
    expect(dayHeading("2026-08-21", dateLocale("fr"))).toMatch(/21 ao/);
    expect(dayHeading("2026-08-21", dateLocale("de"))).toMatch(/21\. Aug/);
  });

  it("leaves the dateless group for the caller to label", () => {
    // The words belong in the message catalogue, not in a lib function.
    expect(dayHeading(NO_DATE, "en-GB")).toBeNull();
  });
});
