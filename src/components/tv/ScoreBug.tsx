"use client";

/**
 * The AVC permanent score bug (spec/47, guidelines item 04).
 *
 * Drawn as SVG in the 1920x1080 broadcast frame, not as positioned divs like the
 * venue boards in src/components/scoreboard. The reason is baselines: the master
 * places its type by baseline, and SVG's `y` on a <text> IS the baseline, exact
 * and identical in every browser. Reproducing that with divs means reasoning
 * about line boxes and half-leading and then correcting with an empirical nudge
 * constant — which is what VisBoard.tsx has to do, and it is a wobble this
 * graphic cannot afford when it is keyed over live footage.
 *
 * Panels, pinstripes, red blocks, roundel and flag accents are ARTWORK cut from
 * the Illustrator master (public/tv-gfx/*, cut by
 * spec/reference/avc-tv-gfx/extract-assets.py). They are not redrawn here and
 * must not be: they are the venue branding itself, and a CSS approximation of a
 * 1:3 slant with a 4 px notch and a 22.5 px pinstripe field is an imitation.
 *
 * Pure: no hooks, no window, no clock. Everything it shows arrives in props, so
 * it renders identically on the server and under the pixel-diff gate.
 */

import {
  ART,
  AVC,
  BAR,
  FLAG,
  FLAG_CLIP,
  FLAG_CLIP_MAX,
  FRAME,
  TEXT,
  TV_FONT,
  displayCode,
  flagSrcFor,
} from "@/lib/tv/bug-geometry";

/** One side of the bar, already resolved to PHYSICAL left/right by the caller. */
export interface BugSide {
  /** The code the feed sent (keys the flag); the graphic maps it for display. */
  code: string;
  /** Points in the current set. */
  score: number;
  /** Sets won. */
  sets: number;
  /** This side is serving. */
  serving: boolean;
}

export function ScoreBug({
  left,
  right,
  hidden = false,
}: {
  left: BugSide;
  right: BugSide;
  /** Kept mounted but invisible, so a hide/show does not re-decode the artwork. */
  hidden?: boolean;
}) {
  return (
    <svg
      viewBox={`0 0 ${FRAME.w} ${FRAME.h}`}
      width="100%"
      height="100%"
      // The overlay must never eat a click meant for the player underneath.
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: hidden ? 0 : 1,
        transition: "opacity 180ms linear",
      }}
      aria-hidden
    >
      <defs>
        <clipPath id="tv-flag-clip-l" clipPathUnits="userSpaceOnUse">
          <polygon
            points={FLAG_CLIP.map(
              ([x, y]) => `${FLAG.outerLeft + x},${BAR.y + y}`,
            ).join(" ")}
          />
        </clipPath>
        <clipPath id="tv-flag-clip-r" clipPathUnits="userSpaceOnUse">
          <polygon
            points={FLAG_CLIP.map(
              ([x, y]) => `${FLAG.outerRight - x},${BAR.y + y}`,
            ).join(" ")}
          />
        </clipPath>
      </defs>

      {/* Flags first: the bar's navy runs behind the flag's slanted edge, and
          the master layers the flag over it. */}
      <Flag code={left.code} side="left" />
      <Flag code={right.code} side="right" />

      {/* The static bar: navy ground, both pinstripe fields, both red SETS
          blocks and the centre roundel, in one cut from the master.

          preserveAspectRatio="none" on every one of these, and it is
          load-bearing rather than tidiness. SVG's default is "xMidYMid meet",
          which PRESERVES the ratio and centres the result — so the plate, cut
          61.25 px tall and drawn into the render's 60 px band, was quietly
          scaled by 0.98 in BOTH axes and centred, putting the red SETS blocks
          4.25 px right of where they were measured. The vertical-only fit is
          the intended one (see bug-geometry.ts) and this is what asks for it. */}
      <image
        href={"/tv-gfx/bug-plate.png"}
        x={ART.plate.x}
        y={ART.plate.y}
        width={ART.plate.w}
        height={ART.plate.h}
        preserveAspectRatio="none"
      />

      {/* The stepped white + blue accent, over the flag it cuts into. */}
      <image
        href={"/tv-gfx/bug-accent-left.png"}
        x={ART.accent.leftX}
        y={ART.accent.y}
        width={ART.accent.w}
        height={ART.accent.h}
        preserveAspectRatio="none"
      />
      <image
        href={"/tv-gfx/bug-accent-right.png"}
        x={ART.accent.rightX}
        y={ART.accent.y}
        width={ART.accent.w}
        height={ART.accent.h}
        preserveAspectRatio="none"
      />

      {/* The serving side's ball. Absent, not dimmed, when nobody is serving —
          between sets and before the first whistle the feed says nothing about
          serve and inventing a side would be a lie on air. */}
      {left.serving || right.serving ? (
        <image
          href={"/tv-gfx/bug-ball.png"}
          x={left.serving ? ART.ball.lx : ART.ball.rx}
          y={ART.ball.y}
          width={ART.ball.w}
          height={ART.ball.h}
          preserveAspectRatio="none"
        />
      ) : null}

      <Cell t={TEXT.code} side="left" value={displayCode(left.code)} />
      <Cell t={TEXT.code} side="right" value={displayCode(right.code)} />
      <Cell t={TEXT.score} side="left" value={String(left.score)} />
      <Cell t={TEXT.score} side="right" value={String(right.score)} />
      <Cell t={TEXT.setValue} side="left" value={String(left.sets)} />
      <Cell t={TEXT.setValue} side="right" value={String(right.sets)} />
      <Cell t={TEXT.setLabel} side="left" value="SETS" />
      <Cell t={TEXT.setLabel} side="right" value="SETS" />
    </svg>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

type Cellish = {
  lcx: number;
  rcx: number;
  baseline: number;
  size: number;
  font: string;
  weight?: number;
};

/** One measured text cell, centred on its advance box and sitting on its baseline. */
function Cell({
  t,
  side,
  value,
}: {
  t: Cellish;
  side: "left" | "right";
  value: string;
}) {
  return (
    <text
      x={side === "left" ? t.lcx : t.rcx}
      y={t.baseline}
      textAnchor="middle"
      fontFamily={t.font === "ancorli" ? TV_FONT.ancorli : TV_FONT.encode}
      fontSize={t.size}
      fontWeight={t.weight}
      fill={AVC.white}
    >
      {value}
    </text>
  );
}

/**
 * A flag, scaled to the bar's height, anchored to its own vertical edge, cut to
 * the notched parallelogram.
 *
 * Two layers, and the lower one is not padding:
 *
 *  - **fit** (`meet` in a box wider than any flag) scales the flag by HEIGHT, so
 *    it fills the bar exactly and keeps its own ratio. This is the flag.
 *  - **cover** (`slice` in a box exactly as wide as the clip reaches) scales it
 *    by WIDTH and crops the overflow vertically.
 *
 * The cover layer exists because the clip reaches ~100 px in from the outer edge
 * at the bottom, while ten of the seventeen flags in this field are 3:2 and so
 * only 90 px wide at this height. Without it, a triangle of the bar's navy shows
 * through the bottom corner of every one of them. With it, that triangle is
 * filled by the flag's own far edge — which is what the supplied 60 px assets do
 * (their content runs to the clip, while Japan's disc proves the flag itself is
 * not stretched to get there).
 *
 * Both are clipped, so the cover layer is only ever visible in the sliver the
 * fitted flag does not reach.
 */
function Flag({ code, side }: { code: string; side: "left" | "right" }) {
  const src = flagSrcFor(code);
  if (!src) {
    // No asset and no usable code: the bar keeps its shape and shows nothing
    // where the flag would be, which is honest. The code still prints in its
    // own cell.
    return null;
  }
  const clip = `url(#tv-flag-clip-${side === "left" ? "l" : "r"})`;
  // Wider than the widest flag in the field at this height (Qatar, 28:11 —
  // 152.6 px), so `meet` is always height-limited.
  const fitBox = 200;
  const left = side === "left";
  return (
    <>
      <image
        href={src}
        x={left ? FLAG.outerLeft : FLAG.outerRight - FLAG_CLIP_MAX}
        y={BAR.y}
        width={FLAG_CLIP_MAX}
        height={BAR.h}
        preserveAspectRatio={left ? "xMinYMid slice" : "xMaxYMid slice"}
        clipPath={clip}
      />
      <image
        href={src}
        x={left ? FLAG.outerLeft : FLAG.outerRight - fitBox}
        y={BAR.y}
        width={fitBox}
        height={BAR.h}
        preserveAspectRatio={left ? "xMinYMid meet" : "xMaxYMid meet"}
        clipPath={clip}
      />
    </>
  );
}
