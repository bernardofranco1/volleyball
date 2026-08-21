/**
 * Board-host mode (spec/38): which paths the public board deployment serves.
 *
 * The point of the flag is that a competition official following a scoreboard
 * link can never land on a scoring-platform page, so the interesting assertions
 * are the NEGATIVE ones.
 */

import { describe, expect, it } from "vitest";
import { isBoardHostPath } from "@/lib/board-host";

describe("board host paths", () => {
  it("serves the board, the indexes and the board's own assets", () => {
    for (const p of [
      "/",
      "/c",
      "/c/comp_vis_1670",
      "/m/27547",
      "/m/mock",
      "/m/27547/",
      "/board-bg/comp_vis_1670.jpg",
      "/board-art/avc-mark.png",
      "/flags/KAZ.png",
      // The TV broadcast overlay and its own assets (spec/47). It has to live
      // here: the board host is the deployment a production truck is pointed
      // at, and without these the route would 404 there while working
      // perfectly in development.
      "/tv",
      "/tv/27547",
      "/tv/mock",
      "/tv-gfx/bug-plate.png",
      "/tv-flags/JPN.webp",
    ]) {
      expect(isBoardHostPath(p), p).toBe(true);
    }
  });

  it("refuses every scoring-platform path, sign-in above all", () => {
    for (const p of [
      "/login",
      "/signin",
      "/admin",
      "/admin/releases",
      "/t/live-events",
      "/t/live-events/dashboard",
      "/t/live-events/scoreboard/vis/comp_vis_1670/27547",
      "/Scoreboard/vis/27547",
      "/Tablets/abc/A",
      "/auth/callback",
      "/settings",
    ]) {
      expect(isBoardHostPath(p), p).toBe(false);
    }
  });

  it("does not open up on a path that merely starts with a served prefix", () => {
    // `/matches` must not pass because `/m` is a prefix of it.
    expect(isBoardHostPath("/matches")).toBe(false);
    expect(isBoardHostPath("/console")).toBe(false);
    expect(isBoardHostPath("/careers")).toBe(false);
  });
});
