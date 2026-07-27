import { describe, expect, it } from "vitest";
import {
  GRASS_ZONES,
  INDOOR_ZONES,
  LIGHT_ZONES,
  ringCrossings,
  ringPath,
  ringPolygon,
  zonePoint,
} from "@/components/court/zones";

/**
 * The rotation animation slides each player from their zone to the next one, so
 * it only READS as a rotation if the ring drawn on court is a simple shape. A
 * self-crossing ring means two players slide through the middle in opposite
 * directions and trade sides on screen — a shuffle, not a rotation. That is the
 * property these tests pin, and it is what caught the Light layout drawing
 * position 2 opposite position 1.
 */

describe("ringPath", () => {
  it("is the order a player visits the zones (p → p-1, 1 → n)", () => {
    expect(ringPath(6)).toEqual([1, 6, 5, 4, 3, 2]);
    expect(ringPath(4)).toEqual([1, 4, 3, 2]);
    expect(ringPath(3)).toEqual([1, 3, 2]);
    expect(ringPath(0)).toEqual([]);
  });
});

describe("zone geometry", () => {
  it("indoor: front 4·3·2, back 5·6·1 (FIVB rule 7.4)", () => {
    expect(INDOOR_ZONES).toEqual({ front: [4, 3, 2], back: [5, 6, 1] });
    // Server (1) is back-bottom; its front-row partner (2) is on the same line.
    expect(zonePoint(INDOOR_ZONES, 1)).toEqual({ column: "back", y: 5 / 6 });
    expect(zonePoint(INDOOR_ZONES, 2)).toEqual({ column: "front", y: 5 / 6 });
  });

  it("light 4-player: 1&2 on one line, 3&4 on the other (rule 8.4.1)", () => {
    const l = LIGHT_ZONES[4];
    expect(zonePoint(l, 1)!.y).toBeCloseTo(zonePoint(l, 2)!.y);
    expect(zonePoint(l, 3)!.y).toBeCloseTo(zonePoint(l, 4)!.y);
    expect(zonePoint(l, 1)!.column).toBe("back");
    expect(zonePoint(l, 2)!.column).toBe("front");
  });

  it("light 5-player: 1&2 on one line, 4&5 on the other (rule 8.4.2)", () => {
    const l = LIGHT_ZONES[5];
    // Two back rows vs three front rows, so the lines are close, not identical.
    expect(Math.abs(zonePoint(l, 1)!.y - zonePoint(l, 2)!.y)).toBeLessThan(0.1);
    expect(Math.abs(zonePoint(l, 5)!.y - zonePoint(l, 4)!.y)).toBeLessThan(0.1);
    expect(zonePoint(l, 3)!.column).toBe("front"); // front-centre
  });

  it("the rotation ring never crosses itself", () => {
    expect(ringCrossings(INDOOR_ZONES, 6)).toEqual([]); // hexagon
    expect(ringCrossings(LIGHT_ZONES[4], 4)).toEqual([]); // rectangle
    expect(ringCrossings(LIGHT_ZONES[5], 5)).toEqual([]); // pentagon
    expect(ringCrossings(GRASS_ZONES[3], 3)).toEqual([]); // triangle
  });

  it("catches the ordering bug it was written for", () => {
    // Light 4-player as it was drawn before rule 8.4.1 was applied: zone 2 at the
    // top of the front column, opposite zone 1 — the ring folds into a bow-tie.
    expect(ringCrossings({ front: [2, 3], back: [4, 1] }, 4).length).toBe(1);
  });

  it("ringPolygon walks the drawn ring in court coordinates", () => {
    // Light 4: back-bottom (1) → back-top (4) → front-top (3) → front-bottom (2).
    expect(ringPolygon(LIGHT_ZONES[4], 4)).toEqual([
      [0, 0.75],
      [0, 0.25],
      [1, 0.25],
      [1, 0.75],
    ]);
  });

  it("documents the unconfirmed grass 4-player layout", () => {
    // Grass 4v4 still draws zone 2 opposite zone 1, so its ring self-crosses. If
    // 4v4 grass numbers zones like Light (1 and 2 in the same line),
    // GRASS_ZONES[4].front becomes [3, 2] and this flips to `toEqual([])`.
    // Pending a grass rulebook — left explicit rather than guessed.
    expect(ringCrossings(GRASS_ZONES[4], 4).length).toBe(1);
  });

  it("zonePoint returns null for a zone that is not drawn", () => {
    expect(zonePoint(LIGHT_ZONES[4], 6)).toBeNull();
  });
});
