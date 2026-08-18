import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamActionsGrid } from "@/components/scoring/shared/LiveControls";
import type { Side } from "@/engine/types";

/**
 * The officiating row (T/O / Sub / Libero / Challenge) carries no team names —
 * its buttons target whichever team's column they sit in. A live match had
 * them fixed at A-left/B-right while the score buttons above followed the
 * court sides, so after a side switch every button acted on the opposite
 * team. Pinned: the columns follow teamASide, same rule as LiveScoreGrid.
 */

const render = (teamASide: Side) =>
  renderToStaticMarkup(
    <TeamActionsGrid teamASide={teamASide}>
      {(team) => <button>{`actions-${team}`}</button>}
    </TeamActionsGrid>,
  );

describe("TeamActionsGrid", () => {
  it("puts team A's actions in the left column while A is on the left court", () => {
    const html = render("LEFT");
    expect(html.indexOf("actions-A")).toBeLessThan(html.indexOf("actions-B"));
  });

  it("mirrors the columns when team A is on the right court", () => {
    const html = render("RIGHT");
    expect(html.indexOf("actions-B")).toBeLessThan(html.indexOf("actions-A"));
  });
});
