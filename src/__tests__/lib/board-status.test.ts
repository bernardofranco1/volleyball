/**
 * The status page's judgement (spec/41).
 *
 * The value of a status page is that green means something, so these test the
 * cases where a naive implementation would be wrongly green — above all the one
 * it exists for: every dependency healthy while the feed has stopped moving.
 */

import { describe, expect, it } from "vitest";
import { isBoardHostPath } from "@/lib/board-host";

// The graders are pure and exported for exactly this reason.
import { __statusInternals } from "@/lib/board-status";

const { pickWorst, headlineFor, gradeMatch } = __statusInternals;

describe("overall verdict", () => {
  it("takes the worst of everything, not the average", () => {
    expect(pickWorst(["ok", "ok", "down"])).toBe("down");
    expect(pickWorst(["ok", "warn", "ok"])).toBe("warn");
    expect(pickWorst(["ok", "ok"])).toBe("ok");
  });

  it("says idle rather than healthy when nothing is running", () => {
    expect(pickWorst(["idle", "idle"])).toBe("idle");
    // One real check passing is enough to call it healthy.
    expect(pickWorst(["idle", "ok"])).toBe("ok");
  });

  it("never claims boards are live when something is down", () => {
    expect(headlineFor("down", [])).toMatch(/not updating/i);
    expect(headlineFor("warn", [])).toMatch(/looking at/i);
  });
});

describe("a live match", () => {
  const base = {
    status: "LIVE" as const, inSetBreak: false, ageSeconds: 1, sinceChangeSeconds: 5,
  };

  it("is fine while the payload is fresh and the score is moving", () => {
    expect(gradeMatch(base)).toBe("ok");
  });

  it("warns when the payload has gone stale", () => {
    expect(gradeMatch({ ...base, ageSeconds: 90 })).toBe("warn");
  });

  it("is DOWN when the feed has stopped advancing, however fresh the payload", () => {
    // The whole point: VIS answering every second, nothing moving. A naive
    // check on payload age alone would call this perfectly healthy.
    expect(gradeMatch({ ...base, ageSeconds: 1, sinceChangeSeconds: 600 })).toBe("down");
  });

  it("tolerates the pauses volleyball actually has", () => {
    // A rally interval, a time-out, a technical time-out: nothing is wrong.
    for (const gap of [20, 35, 62, 88]) {
      expect(gradeMatch({ ...base, sinceChangeSeconds: gap }), `${gap}s`).toBe("ok");
    }
    // A challenge or an injury is worth a look but is not a failure.
    expect(gradeMatch({ ...base, sinceChangeSeconds: 150 })).toBe("warn");
  });

  it("does not call a set break frozen", () => {
    expect(gradeMatch({ ...base, inSetBreak: true, sinceChangeSeconds: 600 })).toBe("ok");
  });

  it("leaves a finished or scheduled match idle, never down", () => {
    expect(gradeMatch({ ...base, status: "FINISHED", sinceChangeSeconds: 99999 })).toBe("idle");
    expect(gradeMatch({ ...base, status: "UPCOMING", sinceChangeSeconds: 99999 })).toBe("idle");
  });
});

describe("the board host serves the status page", () => {
  it("is reachable where the boards are", () => {
    expect(isBoardHostPath("/status")).toBe(true);
  });
});
