/**
 * Board background artwork (spec/40).
 *
 * The point of the competition field is that a competition's artwork can be
 * changed without a commit, so the validator the form uses has to be the same
 * one the board applies — a value the form accepts and the board then refuses
 * would look like the setting silently not working.
 */

import { describe, expect, it } from "vitest";
import { isBoardBackground } from "@/lib/board-theme";

describe("board background sources", () => {
  it("accepts https URLs and same-origin paths", () => {
    for (const v of [
      "https://cdn.example.com/artwork.jpg",
      "https://example.com/a%20b.png?v=2",
      "/board-bg/avc-cup-pattern.jpg",
      "/board-bg/comp_vis_1736.jpg",
    ]) {
      expect(isBoardBackground(v), v).toBe(true);
    }
  });

  it("refuses anything a venue screen could not paint", () => {
    for (const v of [
      "http://cdn.example.com/artwork.jpg", // mixed content on an https board
      "//cdn.example.com/artwork.jpg", // protocol-relative: not same-origin
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "ftp://example.com/a.png",
      "board-bg/relative.jpg",
      "",
    ]) {
      expect(isBoardBackground(v), v).toBe(false);
    }
  });
});
