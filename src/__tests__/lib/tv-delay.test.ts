/**
 * Clamping the graphics delay (spec/47).
 *
 * Small, and here for a specific reason. `MAX_DELAY_S` originally lived in
 * useDelayedBoard.ts, which carries a "use client" directive, and the output
 * page — a Server Component — imported it to clamp `?delay=`. Importing a plain
 * value out of a client module into a Server Component does not give you the
 * value; it gives you a client reference, `Math.min` of which is NaN. The clamp
 * returned NaN, the delayed board then resolved to the FIRST frame in its buffer
 * for the rest of the match, and the only visible symptom was a React warning
 * about a NaN slider value one component away.
 *
 * So: the clamp is tested for NaN explicitly, and it lives in a module with no
 * directive on it.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_DELAY_S, DELAY_STEP_S, MAX_DELAY_S, clampDelay } from "@/lib/tv/delay";

describe("clampDelay", () => {
  it("passes a sane number through", () => {
    expect(clampDelay(12)).toBe(12);
    expect(clampDelay("12.5")).toBe(12.5);
  });

  it("holds the range", () => {
    expect(clampDelay(-5)).toBe(0);
    expect(clampDelay(MAX_DELAY_S + 100)).toBe(MAX_DELAY_S);
  });

  it("never returns NaN, whatever it is handed", () => {
    for (const bad of [
      undefined, null, "", "abc", {}, [], NaN, Infinity, -Infinity, "12abc",
    ]) {
      const got = clampDelay(bad);
      expect(Number.isFinite(got), String(bad)).toBe(true);
      expect(got).toBeGreaterThanOrEqual(0);
    }
  });

  it("is a real number at module scope, not a client reference", () => {
    // The regression itself: if these ever stop being numbers here, the clamp
    // in the Server Component is broken again.
    expect(typeof MAX_DELAY_S).toBe("number");
    expect(typeof DEFAULT_DELAY_S).toBe("number");
    expect(typeof DELAY_STEP_S).toBe("number");
    expect(DEFAULT_DELAY_S).toBeLessThanOrEqual(MAX_DELAY_S);
  });
});
