/**
 * The VIS board head (spec/36): the code that fits, and the flag that is whole.
 *
 * These pin the two failures the change exists to remove — a team name wider
 * than its box, and a flag squeezed into a square — so neither can come back
 * silently the next time the geometry is touched.
 */

import { describe, expect, it } from "vitest";
import { fitCap, widthInCaps } from "@/lib/board-text-fit";
import { flagBox } from "@/components/scoreboard/VisTeamMark";
import { FLAG_RATIO } from "@/lib/board-flag-ratios";

/** The scoreboard master's head box, in design px (see VisBoard MARK). */
const BOX = 306;
const TRACKING = 1;
const SLOT = { w: 195, h: 130, fit: "area" as const };

/** Rendered width at a given cap, the way the board lays it out. */
const rendered = (text: string, capPx: number) =>
  widthInCaps(text) * capPx + TRACKING * (text.length - 1);

describe("head text fitting", () => {
  it("leaves a 3-letter code at the requested cap", () => {
    for (const code of ["KAZ", "TPE", "HKG", "BRA", "QAT"]) {
      expect(fitCap(code, BOX, 72, TRACKING)).toBe(72);
    }
  });

  it("shrinks the name fallback until it fits, rather than clipping it", () => {
    // The three that overflowed the old box at the old character-count caps.
    for (const name of ["Kazakhstan", "Chinese Taipei", "Hong Kong, China"]) {
      const capPx = fitCap(name, BOX, 72, TRACKING);
      expect(capPx).toBeLessThan(72);
      expect(rendered(name.toUpperCase(), capPx)).toBeLessThanOrEqual(BOX);
    }
  });

  it("never returns a cap that overflows, for any federation name we might see", () => {
    const names = [
      "Brazil", "Japan", "Islamic Republic of Iran", "Dominican Republic",
      "United States", "Netherlands", "Türkiye", "New Zealand", "Uzbekistan",
    ];
    for (const name of names) {
      const capPx = fitCap(name, BOX, 72, TRACKING);
      expect(rendered(name.toUpperCase(), capPx)).toBeLessThanOrEqual(BOX);
    }
  });

  it("treats an unknown glyph as the widest one, so it errs towards shrinking", () => {
    expect(widthInCaps("中")).toBeGreaterThan(widthInCaps("I"));
  });
});

describe("flag sizing", () => {
  it("gives every flag the same area, whatever its ratio", () => {
    const target = SLOT.w * SLOT.h;
    for (const code of Object.keys(FLAG_RATIO)) {
      const box = flagBox(code, SLOT);
      expect(box.w * box.h).toBeCloseTo(target, 3);
    }
  });

  it("keeps each flag at its own proportions — never a square", () => {
    for (const [code, ratio] of Object.entries(FLAG_RATIO)) {
      const box = flagBox(code, SLOT);
      expect(box.w / box.h).toBeCloseTo(ratio, 3);
    }
  });

  it("stays clear of the head text: the widest flag still leaves the box room", () => {
    // Left side: the flag grows outward from the master's inner edge at 619.25,
    // and the text box runs from x 23.5 to 23.5 + 306.
    const widest = Math.max(
      ...Object.keys(FLAG_RATIO).map((c) => flagBox(c, SLOT).w),
    );
    expect(619.25 - widest).toBeGreaterThan(23.5 + BOX);
  });

  it("falls back to 3:2 for a code we hold no art for", () => {
    const box = flagBox("ZZZ", SLOT);
    expect(box.w / box.h).toBeCloseTo(1.5, 3);
  });
});
