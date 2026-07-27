/**
 * Court zone geometry for the rotation disciplines — one place, shared by the
 * scorer's SVG court (Indoor/Grass/Light) and the indoor broadcast board, so the
 * two surfaces can never disagree about where a player stands.
 *
 * Each column is listed **top → bottom as drawn**. For the left-hand team the
 * net is on the right, and the team's right-hand side renders at the bottom —
 * so position 1 (the server, back-right) is last in the back column, and the
 * right half is mirrored vertically to put the two servers diagonally opposite.
 *
 * Rulebook references:
 *  - Indoor (FIVB rule 7.4): front row 4·3·2, back row 5·6·1.
 *  - Light/Air (Light Volleyball Competition Rules 2022-2025, 8.4.1 / 8.4.2 and
 *    Diagrams 2-3): four players — front 3·2, back 4·1, with "positions 1 and 2
 *    in the same line; positions 3 and 4 in the same line"; five players — front
 *    4·3·2, back 5·1, with "positions 1 and 2 in the same line; positions 4 and
 *    5 in the same line".
 *
 * Ordering is not cosmetic: rotation moves each player one zone along the ring
 * (1 → n → n-1 → … → 2 → 1). When the columns are ordered as above, every step
 * lands on an ADJACENT zone, so the animated rotation sweeps around the court
 * instead of cutting across it. `ringPath` + the zones test pin that invariant.
 */

export interface ZoneLayout {
  /** Zones in the net-side column, top → bottom as drawn. */
  front: number[];
  /** Zones in the baseline-side column, top → bottom as drawn. */
  back: number[];
}

/** Indoor: six zones, three per column. */
export const INDOOR_ZONES: ZoneLayout = { front: [4, 3, 2], back: [5, 6, 1] };

/** Light / Air: 4- or 5-player formats. */
export const LIGHT_ZONES: Record<number, ZoneLayout> = {
  4: { front: [3, 2], back: [4, 1] },
  5: { front: [4, 3, 2], back: [5, 1] },
};

/**
 * Grass: 3- or 4-player formats.
 *
 * The 3-player layout is a triangle (one player at the net, two behind) — its
 * ring has no crossing. The 4-player layout is NOT yet confirmed against a
 * grass rulebook: if 4v4 grass numbers its zones like Light (1 and 2 in the same
 * line), `front` should read `[3, 2]` — see the zones test.
 */
export const GRASS_ZONES: Record<number, ZoneLayout> = {
  3: { front: [3], back: [2, 1] },
  4: { front: [2, 3], back: [4, 1] },
};

/** Where a zone is drawn: which column, and its row within that column. */
export interface ZonePoint {
  column: "front" | "back";
  /** Row centre as a fraction of the marker band (0 = top, 1 = bottom). */
  y: number;
}

export function zonePoint(layout: ZoneLayout, zone: number): ZonePoint | null {
  const f = layout.front.indexOf(zone);
  if (f >= 0) return { column: "front", y: (f + 0.5) / layout.front.length };
  const b = layout.back.indexOf(zone);
  if (b >= 0) return { column: "back", y: (b + 0.5) / layout.back.length };
  return null;
}

/**
 * The rotation ring: the order in which a single player visits the zones.
 * Rotation sends the player in zone p to zone p-1, and zone 1 to zone n, so the
 * cycle is 1 → n → n-1 → … → 2 → 1.
 */
export function ringPath(n: number): number[] {
  if (n <= 0) return [];
  const path = [1];
  for (let z = n; z >= 2; z--) path.push(z);
  return path;
}

/**
 * The ring as drawn: the closed polyline a rotating player walks, in court
 * coordinates (x: 0 = baseline column, 1 = net column; y: 0 = top, 1 = bottom).
 */
export function ringPolygon(layout: ZoneLayout, n: number): [number, number][] {
  return ringPath(n)
    .map((zone) => zonePoint(layout, zone))
    .filter((p): p is ZonePoint => p != null)
    .map((p) => [p.column === "back" ? 0 : 1, p.y] as [number, number]);
}

/**
 * Pairs of ring steps whose paths cross each other. Zero is the property the
 * animation depends on: a self-intersecting ring means two players slide through
 * the middle of the court in opposite directions and swap sides on screen, which
 * reads as a shuffle rather than a rotation. A ring may be any simple shape —
 * a hexagon (indoor), a rectangle (Light 4) or a triangle (Grass 3).
 */
export function ringCrossings(layout: ZoneLayout, n: number): [number, number][] {
  const pts = ringPolygon(layout, n);
  const segs = pts.map(
    (p, i) => [p, pts[(i + 1) % pts.length]] as [[number, number], [number, number]],
  );
  const bad: [number, number][] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      // Consecutive segments share an endpoint by construction.
      if (j === i + 1 || (i === 0 && j === segs.length - 1)) continue;
      if (segmentsCross(segs[i], segs[j])) bad.push([i, j]);
    }
  }
  return bad;
}

type Seg = [[number, number], [number, number]];

function cross(
  o: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsCross([p1, p2]: Seg, [p3, p4]: Seg): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
