import { describe, expect, it } from "vitest";
import {
  DISCIPLINE_DEFAULTS,
  resolveConfig,
  setBreakSecsAfter,
  timeoutCapForSet,
  type TournamentConfig,
} from "@/engine/config";
import { DISCIPLINES } from "@/engine/types";

describe("DISCIPLINE_DEFAULTS", () => {
  it("covers all four disciplines", () => {
    expect(Object.keys(DISCIPLINE_DEFAULTS).sort()).toEqual(
      [...DISCIPLINES].sort(),
    );
  });

  it("beach: best of 3, 21-point sets, TTO on, 5s serve clock, 2 players", () => {
    const c = DISCIPLINE_DEFAULTS.BEACH;
    expect(c.bestOf).toBe(3);
    expect(c.setScore).toBe(21);
    expect(c.setScoreTiebreak).toBe(15);
    expect(c.ttoEnabled).toBe(true);
    expect(c.serveClockSecs).toBe(5);
    expect(c.playersPerSide).toBe(2);
    expect(c.blockCountsAsTeamHit).toBe(true);
  });

  it("indoor: best of 5, 25-point sets, libero on, deciding-set switch at 8", () => {
    const c = DISCIPLINE_DEFAULTS.INDOOR;
    expect(c.bestOf).toBe(5);
    expect(c.setScore).toBe(25);
    expect(c.liberoEnabled).toBe(true);
    expect(c.liberoCount).toBe(1);
    expect(c.sideSwitchBetweenSetsOnly).toBe(true);
    expect(c.sideSwitchDecidingSetAt).toBe(8);
    expect(c.blockCountsAsTeamHit).toBe(false);
  });

  it("grass: 3 players, no TTO, block counts as team hit", () => {
    const c = DISCIPLINE_DEFAULTS.GRASS;
    expect(c.playersPerSide).toBe(3);
    expect(c.ttoEnabled).toBe(false);
    expect(c.blockCountsAsTeamHit).toBe(true);
  });

  it("light: front-zone arc, 2m attack line, 1m jump-serve line, 4 players", () => {
    const c = DISCIPLINE_DEFAULTS.LIGHT;
    expect(c.frontZoneArcRequired).toBe(true);
    expect(c.attackLineM).toBe(2.0);
    expect(c.jumpServeRestrictionLineM).toBe(1.0);
    expect(c.playersPerSide).toBe(4);
  });

  it("every discipline default is a total config (no undefined fields)", () => {
    for (const d of DISCIPLINES) {
      const c = DISCIPLINE_DEFAULTS[d];
      for (const [key, value] of Object.entries(c)) {
        expect(value, `${d}.${key}`).not.toBeUndefined();
      }
    }
  });
});

describe("resolveConfig", () => {
  it("returns discipline defaults when no overrides are given", () => {
    expect(resolveConfig("BEACH")).toEqual(DISCIPLINE_DEFAULTS.BEACH);
  });

  it("applies non-null overrides over the defaults", () => {
    const c = resolveConfig("BEACH", { ttoEnabled: false, setScore: 15 });
    expect(c.ttoEnabled).toBe(false);
    expect(c.setScore).toBe(15);
    expect(c.bestOf).toBe(3); // untouched default
  });

  it("ignores null overrides (null means 'use default')", () => {
    const c = resolveConfig("INDOOR", {
      liberoCount: null as unknown as number,
    });
    expect(c.liberoCount).toBe(1);
  });

  it("ignores undefined overrides", () => {
    const c = resolveConfig("INDOOR", { liberoCount: undefined });
    expect(c.liberoCount).toBe(1);
  });

  it("does not mutate the shared defaults object", () => {
    const override: Partial<TournamentConfig> = { setScore: 99 };
    resolveConfig("BEACH", override);
    expect(DISCIPLINE_DEFAULTS.BEACH.setScore).toBe(21);
  });
});

describe("timeoutCapForSet", () => {
  it("uses the normal cap for non-deciding sets and the tie-break cap for the decider", () => {
    const c = resolveConfig("INDOOR", {
      timeoutsPerSet: 2,
      timeoutsPerSetTiebreak: 1,
    });
    expect(timeoutCapForSet(c, 1)).toBe(2); // normal set
    expect(timeoutCapForSet(c, 4)).toBe(2); // still not the decider (bestOf 5)
    expect(timeoutCapForSet(c, 5)).toBe(1); // deciding set → tie-break cap
  });
});

describe("setBreakSecsAfter", () => {
  const c = resolveConfig("BEACH", { setBreakDurationsSecs: [30, 90] });
  it("returns the per-break duration by set number", () => {
    expect(setBreakSecsAfter(c, 1)).toBe(30);
    expect(setBreakSecsAfter(c, 2)).toBe(90);
  });
  it("reuses the last value past the end of the array", () => {
    expect(setBreakSecsAfter(c, 5)).toBe(90);
  });
  it("falls back to 60s when misconfigured", () => {
    const empty = resolveConfig("BEACH", { setBreakDurationsSecs: [] });
    expect(setBreakSecsAfter(empty, 1)).toBe(60);
  });
});
