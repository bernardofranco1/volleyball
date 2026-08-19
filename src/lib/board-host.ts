/**
 * Board-host mode (spec/38).
 *
 * The VIS boards have nothing to do with scoring: no login, no tenant, no
 * writes. They are handed to competition staff and pointed at by venue TVs, and
 * anybody following one of those links should not land on a scoring-platform
 * sign-in page. So the same codebase is deployed a SECOND time, with
 * `BOARD_ONLY=1`, on its own hostname; that deployment serves the board routes
 * and nothing else — every other path 404s, including the sign-in page.
 *
 * One codebase rather than a fork, deliberately: the boards are still changing
 * weekly, and a copy would rot within a fortnight. The intended end state is a
 * project of its own with no database at all (the only things it needs are the
 * allowlist of VIS tournaments and each competition's branding); this flag is
 * what makes that a move rather than a rewrite.
 */

import { competitionForMatch, visCompetitions } from "@/lib/vis-live/resolve";
import { MOCK_BOARD_MATCH_NO } from "@/components/scoreboard/VisBoardScreen";

/** True on the board-only deployment. */
export function boardHostEnabled(): boolean {
  return process.env.BOARD_ONLY === "1";
}

/**
 * Paths the board host serves. Everything else is 404 there — including `/`,
 * which the proxy rewrites to the competition index.
 */
export function isBoardHostPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/status" ||
    pathname === "/c" ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/m/") ||
    pathname.startsWith("/board-bg/") ||
    pathname.startsWith("/board-art/") ||
    pathname.startsWith("/flags/")
  );
}

/** The mock board hangs off whichever competition owns its tournament. */
export async function MOCK_BOARD_TENANT() {
  const direct = await competitionForMatch(MOCK_BOARD_MATCH_NO);
  if (direct) return direct;
  const all = await visCompetitions();
  return all[0] ?? null;
}
