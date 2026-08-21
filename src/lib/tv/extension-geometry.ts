/**
 * The score bug's extensions, measured (spec/47).
 *
 * Substitutions (guidelines item 18), the video-challenge states (item 21),
 * time-out (item 22) and the key-moment strap (item 40). All four dock to the
 * bug and none of them touches it: the bug is byte-identical in every reference
 * frame that carries an extension.
 *
 * MEASURED FROM THE RENDERED FRAMES, not from artwork — because there is no
 * artwork. The package ships Illustrator masters for the bar and the lower-third
 * chassis but nothing for these, so unlike the bug (whose panels are lifted
 * wholesale into public/tv-gfx) every shape here is drawn from numbers. The
 * numbers come from the 1920x1080 stills embedded in the guidelines, read by
 * spec/reference/avc-tv-gfx/measure-extensions.py.
 *
 * ONE CHASSIS, FOUR GRAPHICS. Everything is built from three bands and a docking
 * edge, and that is a finding rather than a simplification — the substitution
 * block, the yellow-card block and the challenge cards all put their separator
 * rule on the same row (y 938.5, measured independently in five frames), and the
 * challenge tab and the time-out tab trace to the same sub-pixel outline.
 *
 * Measured constants (design px, y from the top of the 1920x1080 frame):
 *   upper band       y 894 → 938   h 44   left edge slants 0.3049, NO notch
 *   separator rule   y 938 → 940   h  2   #3C81BC, the element's full width
 *   lower band       y 940 → 1000  h 60   slants 0.3247, notch -3.38 at y 969.5
 *   tab band         y 904 → 938   h 34   slants 0.3047, no notch
 *   docking edge     x 525.00 (left-hand) / 1395.00 (right-hand), vertical
 *
 * Two things about these bands that the bug does not do:
 *  - The slant ABOVE the bar (0.3049) is genuinely shallower than the slant
 *    inside it (0.3247 = tan 18°). Measured on four independent edges, max
 *    residual 0.13 px. Surprising, and reported as measured.
 *  - The panels are ~90% opaque where the bug is solid. Solved from the court
 *    showing through: (25,25,63) observed over a (255,150,148) court against a
 *    (0,11,53) source gives 1-a = 0.098/0.101/0.105 on the three channels.
 */

import { AVC } from "./bug-geometry";

/** Where an extension docks, and which way it grows. */
export type Hand = "left" | "right";

export const DOCK = { left: 525, right: 1395 } as const;

/** The three bands, and the slant each one runs at. */
export const BAND = {
  upper: { y: 894, h: 44, slope: 0.3049, notchY: null, notchBack: 0 },
  tab: { y: 904, h: 34, slope: 0.3047, notchY: null, notchBack: 0 },
  lower: { y: 940, h: 60, slope: 0.3247, notchY: 29.5, notchBack: 3.38 },
} as const;

export const RULE = { y: 938, h: 2, fill: AVC.accentBlue } as const;

/** Panels sit at 90% over the picture; the bug itself is solid. */
export const PANEL_OPACITY = 0.9;

/**
 * The gradients, as fractions of the element's own width so they hold at any
 * width. Both run LEFT TO RIGHT in frame coordinates regardless of which way the
 * element grows — measured on the substitution block (which grows leftward) and
 * the tabs (which grow rightward), and the direction is the same in both.
 */
export const GRADIENT = {
  /** Upper band and tabs: a plum end resolving to navy about halfway. */
  upper: [
    { at: 0, colour: "#340A27" },
    { at: 0.55, colour: AVC.navy },
    { at: 1, colour: AVC.navy },
  ],
  /** Lower band: navy to the brand red, all the way across. */
  lower: [
    { at: 0, colour: AVC.navy },
    { at: 1, colour: AVC.red },
  ],
} as const;

/**
 * The pinstripe field the lower band carries (the upper band has none).
 *
 * Drawn, not lifted, and the one place in this feature where that is true of a
 * texture. The bug's pinstripes come out of the Illustrator master; the
 * extensions' cannot, because no master ships them. Pitch and angle are measured
 * off the bug's own field, where the stripe centres fall 22.4 px apart.
 */
export const PINSTRIPE = {
  pitch: 22.4,
  width: 4.5,
  slope: 0.3247,
  colour: "#7A2140",
  opacity: 0.55,
} as const;

/** The red sliver that leads the lower band's outer edge. */
export const LEAD_SLIVER = { w: 8.75, fill: AVC.red } as const;

// ── substitutions (item 18) ─────────────────────────────────────────────────
//
// Offsets are from the DOCKING EDGE, positive meaning "away from the bug", so
// one set of numbers serves both hands.

export const SUB = {
  /** Overall width of both rows, from the docking edge. */
  width: 410,
  upper: {
    /** Position code — bare light-blue type; there is no chip behind it. */
    position: { x: 395, size: 20, weight: 500, baseline: 923, fill: "#4A90C2" },
    /** `near` is the offset from the dock to the shirt's edge nearest the bug. */
    shirt: { near: 295, w: 56, top: 899, h: 39 },
    number: { size: 20, weight: 700, baseline: 926 },
    name: { x: 282, size: 20, weight: 700, baseline: 923, maxW: 200 },
    arrow: { cx: 27.5, top: 910, h: 15, w: 29 },
  },
  lower: {
    position: { x: 384, size: 22, weight: 500, baseline: 978, fill: "#4A90C2" },
    shirt: { near: 273, w: 72, top: 946, h: 54 },
    number: { size: 22, weight: 700, baseline: 978 },
    name: { x: 256, size: 22, weight: 700, baseline: 978, maxW: 205 },
    arrow: { cx: 27.5, top: 959, h: 16, w: 34 },
  },
  /**
   * Solid green marks the player COMING ON, a hollow outline the one going off,
   * and each arrow points at the other row.
   *
   * Inferred, and worth flagging: guidelines p.32 says only "identify the
   * outgoing and incoming players" and never states which row is which or what
   * the arrows mean. What is certain is the drawing — the reference frame has a
   * filled green downward triangle on the upper row and a hollow upward one on
   * the lower — and that the After Effects project ships the pair twice, as
   * `LT Sub Arrow Out-In` and `LT Sub Arrow In-Out`, so the order is a choice
   * the graphic supports either way. Green for arriving is the reading every
   * other sport's graphics take.
   */
  arrowIn: { fill: "#2FB338", stroke: AVC.white, strokeW: 1 },
  arrowOut: { fill: AVC.red, stroke: AVC.white, strokeW: 2 },
} as const;

// ── video challenge (item 21) ───────────────────────────────────────────────

/** The small alert tab, which sits ON the bug and leaves it up. */
export const CHALLENGE_TAB = {
  width: 230,
  /** Grows over the bug, i.e. inward, so its offsets are negative. */
  inward: true,
  text: { size: 20, weight: 700, baseline: 929 },
} as const;

/**
 * The full card: header over category, on the two-row chassis, replacing the
 * bug. Width follows the text rather than being fixed — the five examples on
 * guidelines p.34 measure between roughly 620 and 810 px wide depending on the
 * team name.
 */
export const CHALLENGE_CARD = {
  minWidth: 620,
  /** Wide enough for any team name, narrow enough to stay a lower third. */
  maxWidth: 1180,
  pad: 34,
  /** Padding around the result plate inside the upper band. */
  platePad: 40,
  /** How far off centre the card sits, toward the requesting team. */
  offset: 15,
  header: { size: 26, weight: 700, baseline: 923 },
  result: { size: 33, weight: 700, baseline: 926 },
  category: { size: 30, weight: 700, baseline: 978 },
  /** Successful is the package's accent blue; unsuccessful is the brand red. */
  successFill: AVC.accentBlue,
  failFill: AVC.red,
} as const;

// ── time-out (item 22) ──────────────────────────────────────────────────────

export const TIMEOUT_TAB = {
  width: 230,
  inward: true,
  text: { size: 20, weight: 700, baseline: 929 },
  /** Two pips, 18 px across, 23 px centre to centre, on the text's baseline row. */
  pip: { r: 9, gap: 23, cy: 921, strokeW: 2, fill: "#4A90C2" },
  /** Gap from the end of the word to the first pip. */
  textGap: 8,
} as const;

// ── key moment (item 40) ────────────────────────────────────────────────────

export const KEY_MOMENT = {
  /** The same lower band as a substitution's second row. */
  width: 410,
  /**
   * Ancorli 44px, not the 42 the guidelines state. The rendered strap's ink is
   * 31.00 px tall and Ancorli's caps are 0.700 em, which puts it at 44.3; 42
   * would give 29.4. This is the only string in the package whose measured size
   * misses its stated size by more than a pixel, and the render is what goes to
   * air.
   */
  text: { size: 44, baseline: 984.6 },
} as const;
