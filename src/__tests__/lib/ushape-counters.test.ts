/**
 * The U-shape rail's allowance pips (spec/39).
 *
 * Filled = still available, outline = spent, so the rail counts DOWN like the
 * full board's rows. Eight substitution pips in two rows of four: eight is what
 * the feed reports for these events, and one row of eight made them too small
 * to tell apart from the stands.
 */

import { describe, expect, it } from "vitest";
import { ALLOWANCE, dots } from "@/components/scoreboard/VisBoardUShape";

describe("U-shape allowance pips", () => {
  it("draws one pip per allowance", () => {
    expect(ALLOWANCE).toEqual({ challenges: 2, substitutions: 8, timeouts: 2 });
    expect(dots(8, ALLOWANCE.substitutions)).toHaveLength(8);
    expect(dots(2, ALLOWANCE.timeouts)).toHaveLength(2);
    expect(dots(2, ALLOWANCE.challenges)).toHaveLength(2);
  });

  it("fills what is LEFT and leaves the spent ones as outlines", () => {
    expect(dots(8, 8)).toEqual(Array(8).fill(true));
    expect(dots(3, 8)).toEqual([true, true, true, false, false, false, false, false]);
    expect(dots(0, 8)).toEqual(Array(8).fill(false));
  });

  it("splits eight into two rows of four", () => {
    // The row split is the renderer's `perRow`, but the count has to divide.
    expect(ALLOWANCE.substitutions % 4).toBe(0);
    expect(ALLOWANCE.substitutions / 4).toBe(2);
  });

  it("never shows fewer pips than the feed says are left", () => {
    // An event with a larger allowance than ours must not lose pips.
    expect(dots(10, 8)).toHaveLength(10);
    expect(dots(10, 8).filter(Boolean)).toHaveLength(10);
  });
});

describe("rail flag sizing", () => {
  // The rail is 152 px wide with 20 px of air, so a flag may be at most 132 px
  // across while the head band is 66 px tall — anything wider than 2:1 hits the
  // cap. Clamping the width alone squashed Qatar; the height has to follow.
  const MAX_W = 152 - 20;
  const BAND_H = 66;
  const sized = (ratio: number) => {
    const w = Math.min(MAX_W, BAND_H * ratio);
    return { w, h: w / ratio };
  };

  it("keeps every flag's own proportions, capped or not", () => {
    for (const ratio of [1.429, 1.5, 1.6, 1.667, 1.758, 1.905, 2, 2.54]) {
      const { w, h } = sized(ratio);
      expect(w / h, `ratio ${ratio}`).toBeCloseTo(ratio, 3);
      expect(w).toBeLessThanOrEqual(MAX_W);
      expect(h).toBeLessThanOrEqual(BAND_H);
    }
  });

  it("takes the height down when a flag hits the width cap", () => {
    const wide = sized(2.54);
    expect(wide.w).toBe(MAX_W);
    expect(wide.h).toBeLessThan(BAND_H);
  });
});
