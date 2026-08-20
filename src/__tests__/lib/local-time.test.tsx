import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalTime, SWISS_TIME_ZONE } from "@/components/LocalTime";

/**
 * Timestamps, and which clock they are on.
 *
 * The release console records when somebody changed what production serves, and
 * that has to have ONE answer two people in two countries can read off the same
 * screen and agree on. It is on Swiss official time — the federation's own
 * clock — and it says so, because "14:32" with no zone is exactly the ambiguity
 * worth removing.
 *
 * Venue times are the opposite case and must NOT be pinned: a match at 19:00 is
 * at 19:00 for the person standing in the hall.
 */

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("a pinned zone", () => {
  it("shows Swiss summer time, and names it", () => {
    // 12:34 UTC on 20 August is 14:34 in Zurich — CEST, UTC+2.
    const html = render(
      <LocalTime date={new Date("2026-08-20T12:34:00Z")} timeZone={SWISS_TIME_ZONE} />,
    );
    expect(html).toContain("14:34");
    expect(html).toContain("CEST");
    expect(html).toContain("20 Aug");
  });

  it("follows the changeover into winter without being told", () => {
    // 12:34 UTC on 15 January is 13:34 in Zurich — CET, UTC+1.
    const html = render(
      <LocalTime date={new Date("2026-01-15T12:34:00Z")} timeZone={SWISS_TIME_ZONE} />,
    );
    expect(html).toContain("13:34");
    expect(html).toContain("CET");
    expect(html).not.toContain("CEST");
  });

  it("renders the same string on the server as in the browser", () => {
    // The whole reason the locale is pinned alongside the zone. If this drifted,
    // the release console would hydrate into a React mismatch rather than a
    // merely inconsistent timestamp.
    const date = new Date("2026-08-20T12:34:00Z");
    const server = render(<LocalTime date={date} timeZone={SWISS_TIME_ZONE} />);
    const browser = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: SWISS_TIME_ZONE,
      timeZoneName: "short",
    }).format(date);
    expect(server).toContain(browser);
  });

  it("keeps UTC in the tooltip, whatever it displays", () => {
    const html = render(
      <LocalTime date={new Date("2026-08-20T12:34:00Z")} timeZone={SWISS_TIME_ZONE} />,
    );
    expect(html).toContain('title="2026-08-20 12:34 UTC"');
  });

  it("drops the zone label when there is no clock to qualify", () => {
    const html = render(
      <LocalTime
        date={new Date("2026-08-20T12:34:00Z")}
        mode="date"
        timeZone={SWISS_TIME_ZONE}
      />,
    );
    expect(html).toContain("20 August 2026");
    expect(html).not.toContain("CEST");
  });
});

describe("no pinned zone — the venue case", () => {
  it("server-renders UTC and leaves the zone to the viewer", () => {
    // Unchanged behaviour: the server cannot know the viewer's zone, so it
    // renders UTC and the client swaps after hydration.
    const html = render(<LocalTime date={new Date("2026-08-20T12:34:00Z")} />);
    expect(html).toContain("2026-08-20 12:34 UTC");
    expect(html).not.toContain("CEST");
  });

  it("still says nothing about Switzerland for a match time", () => {
    const html = render(
      <LocalTime date={new Date("2026-01-15T12:34:00Z")} mode="time" />,
    );
    expect(html).toContain("12:34 UTC");
    expect(html).not.toContain("CET");
  });
});

describe("bad input", () => {
  it("renders a dash rather than Invalid Date", () => {
    expect(render(<LocalTime date={null} timeZone={SWISS_TIME_ZONE} />)).toBe("–");
    expect(render(<LocalTime date="not a date" timeZone={SWISS_TIME_ZONE} />)).toBe("–");
  });
});
