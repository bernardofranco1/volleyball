/**
 * What the SERVER draws (spec/47 §0, spec/48 §0.1-0.3).
 *
 * The bug is the one graphic in this feature that is not allowed to be
 * client-side: `/tv/{matchNo}` fetches the board on the server so the bar is
 * populated on the FIRST PAINTED FRAME, and an overlay that pops in a rally
 * later is one the director has already cut away from. spec/48 adds motion on
 * top of it, and motion is the obvious way to lose that property — a digit that
 * only exists once an animation has mounted is a digit missing from the frame a
 * vision mixer takes to air.
 *
 * So this pins the DEFAULTS: with no motion props at all, the server's output
 * carries the score and the serve ball. The overlay hides them by passing the
 * flags, and only ever after it has mounted its own copies.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreBug, type BugSide } from "@/components/tv/ScoreBug";

const side = (over: Partial<BugSide> = {}): BugSide => ({
  code: "JPN",
  score: 12,
  sets: 1,
  serving: false,
  ...over,
});

const render = (props: Partial<Parameters<typeof ScoreBug>[0]> = {}) =>
  renderToStaticMarkup(
    <ScoreBug
      left={side({ serving: true })}
      right={side({ code: "POL", score: 25, sets: 2 })}
      {...props}
    />,
  );

describe("the bug as the server renders it", () => {
  it("carries the score and the serve ball with no motion props", () => {
    const html = render();
    expect(html).toContain(">12</text>");
    expect(html).toContain(">25</text>");
    expect(html).toContain("/tv-gfx/bug-ball.png");
    // And nothing hidden: the motion layer is not mounted yet, so there is
    // nothing else drawing either of them.
    expect(html).not.toContain('visibility="hidden"');
  });

  it("hands the score cells over when the odometer asks for them", () => {
    const html = render({ scoreHidden: true });
    // Still in the markup — the overlay draws over the same cells and the
    // geometry gates read them — but no longer painted twice.
    expect(html).toContain(">12</text>");
    expect(html).toContain('visibility="hidden"');
  });

  it("hands the ball over when the flight asks for it", () => {
    expect(render({ ballHidden: true })).not.toContain("/tv-gfx/bug-ball.png");
  });

  it("draws no ball at all when nobody is serving", () => {
    // Between sets and before the first whistle the feed says nothing about
    // serve, and inventing a side would be a lie on air.
    const html = renderToStaticMarkup(
      <ScoreBug left={side()} right={side({ code: "POL" })} />,
    );
    expect(html).not.toContain("/tv-gfx/bug-ball.png");
  });

  it("stays mounted when hidden, so a hide/show does not re-decode the artwork", () => {
    const html = render({ hidden: true });
    expect(html).toContain("/tv-gfx/bug-plate.png");
    expect(html).toContain("opacity:0");
  });
});
