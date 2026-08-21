import { FLAG_CODES, TV_FLAG_CODES } from "@/lib/board-flag-ratios";

/**
 * The AVC TV score bug, measured (spec/47).
 *
 * Design space is the 1920x1080 broadcast frame, y from the top. The graphic is
 * FINISHED DESIGN: nothing here may be nudged to taste. If it looks wrong,
 * re-measure — the tools are in spec/reference/avc-tv-gfx (`layers.py` isolates
 * an Illustrator master's layers, `measure-extensions.py` reads the reference
 * frames, `validate-bug.py` rebuilds the bar from these constants and diffs it).
 *
 * TWO MASTERS, AND WHICH ONE WINS
 *
 * The package describes this bar twice and the two do not agree:
 *
 *   04_Scoreboard.ai   a full-frame mock-up (it embeds a photograph). Its bar is
 *                      61.25 px tall, it mirrors about x 960.76, and its flags
 *                      are placeholders — Thailand's red is a generic (249,19,25)
 *                      against the official #A51931, and its Korean flag carries
 *                      a 1.37 ratio against the real 1.4988.
 *   the rendered graphic  as it appears on guidelines p.23 and in every other
 *                      reference frame, embedded there at native 1920x1080. Its
 *                      bar is 60.00 px tall and it mirrors about x 960.00.
 *
 * The RENDER WINS, on three grounds: it is what goes to air; `LT_Bar.ai`, the
 * lower-third bar the rest of the package is built from, is authored 60 pt tall,
 * so two independent sources say 60; and the render's flags are the real ones,
 * which is why its country codes sit 6 px further in than the mock-up's — the
 * placeholder flag was ~11 px narrower and the panel behind it correspondingly
 * wider.
 *
 * The mock-up is still the only source for the ARTWORK — the pinstripe field,
 * the red blocks, the roundel — so that is cut from it and fitted to the 60 px
 * band. Fitted vertically only: scaling it uniformly would move the red blocks
 * off the x positions the render agrees with to a tenth of a pixel. The cost is
 * that the artwork's 18° slants become 18.4°, which is 0.4 px of horizontal run
 * over the whole bar.
 *
 * Measured constants (design px):
 *   bar                 y 940.00 → 1000.00                     h 60.00
 *   flag outer edges    x 525.00 (left) and 1395.00 (right), both vertical
 *   red SETS block L    755.81 @top → 771.20 @bottom (left edge)
 *   red SETS block R    1093.10 @top → 1077.52 @bottom (left edge)
 *   AVC roundel         x 937 → 983   y 946 → 990        centre x 960
 *   serve ball          w 24.50, centred in the band; slots at x 846.50 / 1049.00
 *
 * Type, from measured ink against the true font ratios, each confirmed against
 * the guidelines' own specification table (p.23) to within half a pixel:
 *   country code   Ancorli 48px               cap ink 34.00
 *   game score     Ancorli 48px               digit ink 34.00
 *   set score      Encode Sans SemiBold 32px  digit ink 24.00
 *   "SETS"         Encode Sans Bold 13px      cap ink 10.00
 *
 * Every panel edge slants tan 18° (0.3249, NOT 1/3 — that is wrong by half a
 * pixel of run across the bar) and steps back at one notch. None of it is drawn
 * in code: the panels, pinstripes, blocks, roundel and accents are artwork. The
 * slant survives here only in the flag clip, because a flag is the one part of
 * the bar that changes.
 */

/** The broadcast frame these numbers live in. */
export const FRAME = { w: 1920, h: 1080 } as const;

/** Top and height of the bar. Everything else hangs off this. */
export const BAR = { y: 940, h: 60 } as const;

/** The axis the whole bug mirrors about — the frame's centre, measured. */
export const AXIS = 960;

/** Where each extracted asset sits. `plate` is fitted vertically; see above. */
export const ART = {
  plate: { x: 596.5, y: BAR.y, w: 730.25, h: BAR.h },
  /**
   * The stepped white + light-blue accent beside each flag, cut from the
   * mock-up but placed where the REAL treatment puts it: its blue sliver's left
   * edge lands on the flag's clip edge, 82.6 px in from the flag's outer edge.
   * Measured independently in the render at 607.6, which agrees to a third of a
   * pixel.
   */
  accent: { w: 24, h: BAR.h, y: BAR.y, leftX: 607.6, rightX: 1288.4 },
  /**
   * The serve ball, centred in the band. Its slot mirrors about AXIS; no
   * reference frame shows a right-hand serve, so that slot is the mirror of a
   * measured left one rather than a measurement of its own.
   */
  ball: {
    w: 24.5,
    h: 24.5,
    y: BAR.y + (BAR.h - 24.5) / 2,
    lx: 846.5,
    rx: FRAME.w - 846.5 - 24.5,
  },
} as const;

/**
 * The flag slot. `outer` is the flag's own vertical edge: the flag is anchored
 * there and the slant is a cut.
 *
 * All of this is measured from the flag assets the package supplies ready-made
 * at exactly this height (guidelines p.12, embedded there at native 106x60 for a
 * 3:2 flag). Two things that measurement settled:
 *
 *  - The flag is NEITHER stretched NOR sheared to fill the parallelogram. Japan's
 *    disc comes out 37x36 with no centre drift top-to-bottom, and China's large
 *    star sits at 14.5 — i.e. one sixth of a 90 px width, the natural 3:2 width
 *    at this height, not of the 100 px the clip reaches.
 *  - Which means the clip reaches PAST a 3:2 flag's own width at the bottom, by
 *    about 10 px, and something has to fill that corner. See ScoreBug's cover
 *    layer.
 */
export const FLAG = {
  outerLeft: 525,
  outerRight: 1395,
  /** Inset of the clip edge at the bar's top, from the outer edge. */
  clipTop: 83,
  /** tan 18°, the package's slant. */
  slope: 0.3249,
  /** Where the edge steps back, measured from the bar's top. */
  notchY: 29.5,
  /** How far it steps back — toward the flag, i.e. the bar's interior. */
  notchBack: 3,
} as const;

/**
 * The flag clip as offsets from the flag's outer vertical edge, in a box
 * BAR.h tall. Six points: down the outer edge, out along the top, the slant to
 * the notch, the step back, the slant again to the bottom.
 */
export const FLAG_CLIP: readonly (readonly [number, number])[] = (() => {
  const { clipTop, slope, notchY, notchBack } = FLAG;
  const atNotch = clipTop + slope * notchY;
  const afterNotch = atNotch - notchBack;
  const atBottom = afterNotch + slope * (BAR.h - notchY);
  return [
    [0, 0],
    [clipTop, 0],
    [atNotch, notchY],
    [afterNotch, notchY],
    [atBottom, BAR.h],
    [0, BAR.h],
  ] as const;
})();

/** The widest the clip ever reaches, and so the width the cover layer needs. */
export const FLAG_CLIP_MAX =
  FLAG.clipTop + FLAG.slope * BAR.h - FLAG.notchBack;

/**
 * Text cells. `cx` is the centre of the ADVANCE box — CSS and SVG both centre
 * the advance box, not the ink, so this is the number that makes a centred
 * string land where the master put it. Each is derived from the render's
 * measured ink box and the font's own side bearings at the stated size.
 *
 * `baseline` is one value per row for both sides, which the render supports: its
 * two country codes agree to half a pixel, where the mock-up's sat 1.45 px apart
 * from hand placement.
 */
export const TEXT = {
  code: {
    lcx: 690.52,
    rcx: 1229.43,
    baseline: 986.75,
    size: 48,
    font: "ancorli",
  },
  score: {
    lcx: 899.66,
    rcx: 1019.66,
    baseline: 986.8,
    size: 48,
    font: "ancorli",
  },
  setValue: {
    lcx: 798.91,
    rcx: 1120.91,
    baseline: 972.85,
    size: 32,
    font: "encode",
    weight: 600,
  },
  setLabel: {
    lcx: 800.3,
    rcx: 1120.3,
    baseline: 989.8,
    size: 13,
    font: "encode",
    weight: 700,
  },
} as const;

/** The palette, from the guidelines' colour page (p.10). Three colours. */
export const AVC = {
  navy: "#000B35",
  red: "#E81C37",
  white: "#FFFFFF",
  /**
   * The accent blue, measured in the flag treatment and in the extensions' 2 px
   * separator rule (60,129,188). Not on the guidelines' colour page — it belongs
   * to the graphics' furniture rather than to the brand palette — but the
   * challenge-result banner needs a blue and this is the package's own.
   */
  accentBlue: "#3C81BC",
} as const;

/** Font stacks for the two package faces. */
export const TV_FONT = {
  ancorli: "var(--font-ancorli),system-ui,sans-serif",
  encode: "var(--font-encode-sans-expanded),system-ui,sans-serif",
} as const;

/**
 * Three-letter code as the GRAPHIC shows it, from the code the FEED sends.
 *
 * The guidelines publish their own abbreviation table (p.11) and it disagrees
 * with the volleyball federation codes VIS and VolleyStation use for three of
 * the AVC field. The flag files stay keyed by the feed's code; only the letters
 * on screen change.
 */
const DISPLAY_CODE: Record<string, string> = {
  INA: "IDN", // Indonesia
  IRI: "IRN", // Iran
  BRN: "BHR", // Bahrain
};

export function displayCode(feedCode: string): string {
  const c = feedCode.toUpperCase();
  return DISPLAY_CODE[c] ?? c;
}

/**
 * The flag asset for a feed code: the package's own file first, then the venue
 * boards' library, then nothing (the component shows the code instead).
 *
 * Two libraries rather than one because they are not the same assets. The
 * package flags carry the official colours — Thailand's red is #A51931 there
 * against a generic bright red in the mock-up — and the guidelines require the
 * supplied ones be used as supplied. public/flags exists for every federation
 * the platform has ever scored; public/tv-flags for the 17 in this competition.
 */
export function flagSrcFor(feedCode: string): string | null {
  const c = feedCode.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  // Both libraries are checked against a GENERATED list of what is actually on
  // disk, never requested hopefully. An SVG <image> pointing at a missing file
  // does not fail quietly the way an <img> with an onError handler does — it
  // draws the browser's broken-image glyph, and a grey torn-page icon in the
  // flag slot of a live broadcast is the worst failure this graphic has.
  //
  // Found twice: first on the replay board, a Qatar v Venezuela fixture from
  // outside this competition, and then on production, where the board host also
  // serves a VNL rehearsal tournament whose Serbia has no asset in either
  // library.
  if (TV_FLAG_CODES.has(c)) return `/tv-flags/${c}.webp`;
  if (FLAG_CODES.has(c)) return `/flags/${c}.png`;
  return null;
}
