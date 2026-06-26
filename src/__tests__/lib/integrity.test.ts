import { describe, expect, it } from "vitest";
import { findSequenceGaps } from "@/lib/integrity";

describe("findSequenceGaps", () => {
  it("reports a clean contiguous log", () => {
    const r = findSequenceGaps([1, 2, 3, 4, 5]);
    expect(r).toMatchObject({ count: 5, max: 5, gaps: [], duplicates: [], ok: true });
  });

  it("detects gaps (dropped events)", () => {
    const r = findSequenceGaps([1, 2, 4, 7]);
    expect(r.gaps).toEqual([3, 5, 6]);
    expect(r.ok).toBe(false);
  });

  it("detects duplicates", () => {
    const r = findSequenceGaps([1, 2, 2, 3]);
    expect(r.duplicates).toEqual([2]);
    expect(r.ok).toBe(false);
  });

  it("handles an empty log", () => {
    expect(findSequenceGaps([])).toMatchObject({ count: 0, max: 0, gaps: [], ok: true });
  });

  it("is order-independent", () => {
    expect(findSequenceGaps([3, 1, 2]).ok).toBe(true);
  });
});
