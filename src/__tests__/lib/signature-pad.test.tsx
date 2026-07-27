import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PAD_RATIO, SignaturePad, pathOf } from "@/components/scoring/shared/SignaturePad";

/**
 * The signing pad had two geometry defects that made it unusable: the ink was
 * drawn with `stroke-width: 0.006` *and* `vector-effect: non-scaling-stroke`,
 * which means 6/1000ths of a screen pixel — invisible — and the strokes were
 * stored with y in 0..1 while the viewBox was `0 0 1 0.32`, so anything below the
 * top third of the pad fell outside it. Both are pinned here.
 */

const strokes = {
  pad: { w: 1, h: PAD_RATIO },
  strokes: [
    [
      [0.1, 0.2],
      [0.5, 0.85],
      [0.9, 0.4],
    ],
    [[0.3, 0.95]], // a dot near the bottom edge — must still be inside the box
  ],
};

const render = (value: typeof strokes | null) =>
  renderToStaticMarkup(
    <SignaturePad value={value} onChange={() => {}} ariaLabel="Signature area" />,
  );

describe("signature pad", () => {
  it("draws in a unit-square viewBox so a point lands where it was drawn", () => {
    const html = render(strokes);
    expect(html).toContain('viewBox="0 0 1 1"');
    // Stretched to the box, which itself carries the pad's aspect ratio.
    expect(html).toContain('preserveAspectRatio="none"');
  });

  it("uses an ink width that is actually visible", () => {
    const html = render(strokes);
    const width = Number(/stroke-width="([\d.]+)"/.exec(html)?.[1]);
    expect(Number.isFinite(width)).toBe(true);
    // With non-scaling-stroke the value is in screen pixels, so it must be a real
    // pen width — the original 0.006 was the bug.
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(width).toBeGreaterThanOrEqual(1.5);
    expect(width).toBeLessThanOrEqual(6);
  });

  it("renders one path per stroke, including a single-point dot", () => {
    const html = render(strokes);
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain("M 0.1 0.2 L 0.5 0.85 L 0.9 0.4");
  });

  it("renders nothing but the empty pad when there is no signature", () => {
    const html = render(null);
    expect(html.match(/<path /g)).toBeNull();
    expect(html).toContain('viewBox="0 0 1 1"');
  });

  it("pathOf handles the degenerate cases", () => {
    expect(pathOf([])).toBe("");
    expect(pathOf([[0.5, 0.5]])).toBe("M 0.5 0.5 l 0.001 0"); // dot
    expect(pathOf([[0, 0], [1, 1]])).toBe("M 0 0 L 1 1");
  });

  it("disables the pad and shows the hint when a name is still required", () => {
    const html = renderToStaticMarkup(
      <SignaturePad
        value={null}
        onChange={() => {}}
        disabled
        disabledHint="Enter the first referee's name to sign"
        ariaLabel="Signature area"
      />,
    );
    expect(html).toContain("Enter the first referee&#x27;s name to sign");
    expect(html).toContain("cursor-not-allowed");
  });
});
