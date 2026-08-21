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
import { flagSrcFor } from "@/lib/tv/bug-geometry";

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

// ── flag assets (spec/47) ───────────────────────────────────────────────────
//
// Here rather than in a file of its own because it guards the same class of
// mistake as the clamp above: something that typechecks, renders, and is wrong
// only on a surface nobody was looking at.

describe("flagSrcFor", () => {
  it("prefers the AVC package's own asset for a competition federation", () => {
    expect(flagSrcFor("JPN")).toBe("/tv-flags/JPN.webp");
    expect(flagSrcFor("THA")).toBe("/tv-flags/THA.webp");
  });

  it("falls back to the platform library for a federation outside the package", () => {
    // The replay board is a Qatar v Venezuela fixture.
    expect(flagSrcFor("VEN")).toBe("/flags/VEN.png");
    expect(flagSrcFor("POL")).toBe("/flags/POL.png");
  });

  it("returns NOTHING when neither library has the flag", () => {
    // The regression: an SVG <image> pointing at a missing file draws the
    // browser's broken-image glyph — a grey torn-page icon in the flag slot of
    // a live broadcast. Serbia reached production that way, from the VNL
    // rehearsal fixtures the board host also serves.
    for (const code of ["SRB", "GER", "NED", "BEL", "CAN", "UKR"]) {
      expect(flagSrcFor(code), code).toBeNull();
    }
  });

  it("refuses anything that is not a three-letter code", () => {
    for (const bad of ["", "J", "JAPAN", "jp1", "  "]) {
      expect(flagSrcFor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is case-insensitive, since feeds are not consistent", () => {
    expect(flagSrcFor("jpn")).toBe("/tv-flags/JPN.webp");
  });
});
