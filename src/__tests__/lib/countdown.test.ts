import { describe, expect, it } from "vitest";
import { activeCountdown } from "@/components/scoring/shared/CountdownOverlay";
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";

// `activeCountdown` is the single source of the deadline shown on the scorer
// console, the team tablets and the public board — one pure function so the
// three surfaces can never disagree about the remaining time.
const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const START = "2026-07-27T12:00:00.000Z";
const ms = (iso: string) => Date.parse(iso);

const base = { rallyPhase: "BETWEEN_RALLIES", currentSetNumber: 1 };

describe("activeCountdown", () => {
  it("returns null between rallies", () => {
    expect(activeCountdown(base, BEACH)).toBeNull();
  });

  it("beach TTO: deadline is TTO_START + the configured TTO length", () => {
    const cd = activeCountdown(
      { ...base, rallyPhase: "TTO_ACTIVE", ttoStartedAt: START },
      BEACH,
    );
    expect(cd).toEqual({
      kind: "TTO",
      deadlineMs: ms(START) + 30_000, // FIVB beach default (rule 15.4.2)
      team: null,
    });
  });

  it("beach TTO honours a competition override of the TTO length", () => {
    const cd = activeCountdown(
      { ...base, rallyPhase: "TTO_ACTIVE", ttoStartedAt: START },
      resolveConfig("BEACH", { ttoDurationSecs: 60 }),
    );
    expect(cd?.deadlineMs).toBe(ms(START) + 60_000);
  });

  it("no TTO clock without a start timestamp (pre-countdown snapshots)", () => {
    expect(
      activeCountdown({ ...base, rallyPhase: "TTO_ACTIVE" }, BEACH),
    ).toBeNull();
  });

  it("team time-out and set break are unchanged", () => {
    expect(
      activeCountdown(
        {
          ...base,
          rallyPhase: "TIMEOUT_ACTIVE",
          activeTimeoutTeam: "B",
          activeTimeoutStartedAt: START,
        },
        BEACH,
      ),
    ).toEqual({
      kind: "TIMEOUT",
      deadlineMs: ms(START) + BEACH.timeoutDurationSecs * 1000,
      team: "B",
    });
    expect(
      activeCountdown(
        { ...base, rallyPhase: "SET_BREAK", setBreakStartedAt: START },
        BEACH,
      )?.kind,
    ).toBe("SET_BREAK");
  });
});
