import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LightCourt } from "@/components/court/LightCourt";
import { IndoorCourt } from "@/components/court/IndoorCourt";

/**
 * Rotation animation regression tests (spec/08 "Rotation motion").
 *
 * The reported symptom was that some players "materialised" in their new zone
 * while others slid. Cause: the markers were emitted in ZONE order, so every
 * rotation reshuffled document order, React moved the keyed nodes, and a DOM
 * move (remove + re-insert) cancels the node's running CSS transition — the
 * moved players jumped, the rest animated.
 *
 * So the invariants worth pinning are structural, and they are checkable without
 * a browser: (1) document order never changes across a rotation, (2) every
 * marker carries the shared transition class, (3) each player's drawn point
 * advances exactly one ring edge.
 */

type Lite = {
  id: string;
  fullName: string;
  jerseyNumber: number | null;
  isLibero: boolean;
};

const roster = (n: number): Map<string, Lite> =>
  new Map(
    Array.from({ length: n }, (_, i) => [
      `a${i + 1}`,
      {
        id: `a${i + 1}`,
        fullName: `Player ${i + 1}`,
        jerseyNumber: i + 1,
        isLibero: false,
      },
    ]),
  );

interface Placed {
  jersey: string;
  x: number;
  y: number;
}

/** The court SVG's vertical midline: markers beyond it belong to team B. */
const COURT_MIDLINE_X = 160;

/** Markers of the left-hand half, in document order, with their drawn point. */
function placed(html: string): Placed[] {
  const out: Placed[] = [];
  const re =
    /<g class="court-rotate" style="transform:translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)[^"]*"><g>(.*?)<\/g><\/g>/g;
  for (const m of html.matchAll(re)) {
    const [, x, y, inner] = m;
    if (Number(x) > COURT_MIDLINE_X) continue; // right half is the mirrored opponent
    const jersey = /dominant-baseline="central"[^>]*>(\d+)</.exec(inner)?.[1];
    if (jersey) out.push({ jersey, x: Number(x), y: Number(y) });
  }
  return out;
}

const lightAt = (rot: number) =>
  placed(
    renderToStaticMarkup(
      <LightCourt
        courtPositionsA={["a1", "a2", "a3", "a4"]}
        courtPositionsB={["b1", "b2", "b3", "b4"]}
        currentServer="A"
        lastRotA={rot}
        lastRotB={null}
        teamASide="LEFT"
        teamAName="A"
        teamBName="B"
        teamAColor="#3366cc"
        teamBColor="#cc3333"
        rosterById={roster(4) as never}
      />,
    ),
  );

const indoorWith = (order: string[]) =>
  placed(
    renderToStaticMarkup(
      <IndoorCourt
        courtPositionsA={order}
        courtPositionsB={["b1", "b2", "b3", "b4", "b5", "b6"]}
        currentServer="A"
        teamASide="LEFT"
        teamAName="A"
        teamBName="B"
        teamAColor="#3366cc"
        teamBColor="#cc3333"
        rosterById={roster(6) as never}
        liberoIdA={null}
        liberoIdB={null}
      />,
    ),
  );

/** One ring edge = a move along exactly one axis, by one row/column step. */
function isOneEdge(from: Placed, to: Placed): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx > 0 && dy > 0) return false; // diagonal — cuts across the court
  return dx + dy > 0;
}

describe("rotation animation — scorer court", () => {
  it("air/light: document order is identical before and after a rotation", () => {
    // If this order changes, React moves the nodes and the browser kills the
    // in-flight transitions — the bug that made players materialise.
    const before = lightAt(0).map((p) => p.jersey);
    const after = lightAt(1).map((p) => p.jersey);
    expect(after).toEqual(before);
    expect(before).toHaveLength(4);
  });

  it("indoor: document order is identical before and after a rotation", () => {
    const before = indoorWith(["a1", "a2", "a3", "a4", "a5", "a6"]);
    const after = indoorWith(["a2", "a3", "a4", "a5", "a6", "a1"]);
    expect(after.map((p) => p.jersey)).toEqual(before.map((p) => p.jersey));
    expect(before).toHaveLength(6);
  });

  it("every player moves, by exactly one ring edge, on one axis", () => {
    for (const [before, after] of [
      [lightAt(0), lightAt(1)],
      [
        indoorWith(["a1", "a2", "a3", "a4", "a5", "a6"]),
        indoorWith(["a2", "a3", "a4", "a5", "a6", "a1"]),
      ],
    ] as const) {
      for (const from of before) {
        const to = after.find((p) => p.jersey === from.jersey)!;
        expect(to, `jersey ${from.jersey} vanished`).toBeDefined();
        expect(
          isOneEdge(from, to),
          `jersey ${from.jersey}: (${from.x},${from.y}) → (${to.x},${to.y})`,
        ).toBe(true);
      }
    }
  });

  it("all markers share the one transition class (nobody is left un-animated)", () => {
    const html = renderToStaticMarkup(
      <LightCourt
        courtPositionsA={["a1", "a2", "a3", "a4"]}
        courtPositionsB={["b1", "b2", "b3", "b4"]}
        currentServer="A"
        lastRotA={0}
        lastRotB={null}
        teamASide="LEFT"
        teamAName="A"
        teamBName="B"
        teamAColor="#3366cc"
        teamBColor="#cc3333"
        rosterById={roster(4) as never}
      />,
    );
    // One .court-rotate wrapper per on-court player, both halves.
    const playersOnCourt = 4 + 4;
    expect(html.match(/class="court-rotate"/g)).toHaveLength(playersOnCourt);
  });

  it("the serve marker is always present, opacity-crossfaded", () => {
    const html = renderToStaticMarkup(
      <LightCourt
        courtPositionsA={["a1", "a2", "a3", "a4"]}
        courtPositionsB={["b1", "b2", "b3", "b4"]}
        currentServer="A"
        lastRotA={0}
        lastRotB={null}
        teamASide="LEFT"
        teamAName="A"
        teamBName="B"
        teamAColor="#3366cc"
        teamBColor="#cc3333"
        rosterById={roster(4) as never}
      />,
    );
    // Two serve elements per marker (ring + ball badge).
    const playersOnCourt = 4 + 4;
    expect(html.match(/class="court-serve"/g)).toHaveLength(playersOnCourt * 2);
    expect(html).toMatch(/class="court-serve"[^>]*opacity="1"/);
    expect(html).toMatch(/class="court-serve"[^>]*opacity="0"/);
  });
});
