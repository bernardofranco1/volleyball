import { describe, expect, it } from "vitest";
import {
  bracketSize,
  isKnockoutRound,
  roundLabel,
  roundOrderIndex,
  seedOrder,
} from "@/lib/bracket";

describe("bracket helpers", () => {
  it("standard seed order for 4 / 8 / 16", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // 16 must be a permutation of 1..16 with adjacent pairs summing to 17.
    const o = seedOrder(16);
    expect(o.length).toBe(16);
    expect([...o].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    for (let i = 0; i < 16; i += 2) expect(o[i] + o[i + 1]).toBe(17);
  });

  it("bracketSize floors to a power of two (min 2)", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(2);
    expect(bracketSize(5)).toBe(4);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(9)).toBe(8);
    expect(bracketSize(1)).toBe(2);
  });

  it("round labels by team count", () => {
    expect(roundLabel(2)).toBe("Final");
    expect(roundLabel(4)).toBe("Semifinal");
    expect(roundLabel(8)).toBe("Quarterfinal");
    expect(roundLabel(16)).toBe("Round of 16");
  });

  it("knockout round detection + display ordering", () => {
    expect(isKnockoutRound("Semifinal")).toBe(true);
    expect(isKnockoutRound("Pool")).toBe(false);
    expect(isKnockoutRound(null)).toBe(false);
    expect(roundOrderIndex("Quarterfinal")).toBeLessThan(roundOrderIndex("Final"));
    expect(roundOrderIndex("Final")).toBeLessThan(roundOrderIndex("3rd Place"));
  });
});
