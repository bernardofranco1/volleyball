/**
 * Fit a TV graphic's variable-length string into its fixed box (spec/47).
 *
 * The board equivalent, src/lib/board-text-fit.ts, works in CAP HEIGHTS because
 * that is how the venue masters are dimensioned. The broadcast package specifies
 * FONT SIZES — "Encode Sans Expanded, Bold, 22px" — so this works in font size,
 * and the two are deliberately separate rather than one clever module with a
 * unit flag.
 *
 * Arithmetic, from the generated advance table, for the same reason: the overlay
 * is server-rendered on first paint and a browser measurement pass would paint
 * one size and then jump, on air.
 *
 * Only two strings in scope need it — a substituted player's name, and the
 * requesting team's name in "VIDEO CHALLENGE BY …". Everything else on these
 * graphics is a fixed string or a number in a cell sized for two digits.
 */

import { ENCODE_SANS_BOLD_METRICS } from "@/lib/board-text-metrics";

/** Absorbs the kerning the table omits (<1% on real names) plus rounding. */
const SAFETY = 0.985;

/** Rendered width of `text` at `size` px, in px, ignoring letter-spacing. */
export function textWidth(text: string, size: number): number {
  const { advance, fallbackAdvance, unitsPerEm } = ENCODE_SANS_BOLD_METRICS;
  let units = 0;
  for (const ch of text) units += advance[ch] ?? fallbackAdvance;
  return (units / unitsPerEm) * size;
}

/**
 * The largest font size (design px) at which `text` fits `boxWidth`, never
 * above `maxSize`. Shrinks, never truncates: a clipped name on a broadcast
 * lower third is a mistake the director cannot undo, a slightly small one is
 * not.
 */
export function fitFontSize(
  text: string,
  boxWidth: number,
  maxSize: number,
  letterSpacing = 0,
): number {
  const t = text.trim();
  if (!t) return maxSize;
  const tracking = letterSpacing * Math.max(0, t.length - 1);
  const available = (boxWidth - tracking) * SAFETY;
  const natural = textWidth(t, maxSize);
  if (natural <= 0 || available <= 0) return maxSize;
  return Math.min(maxSize, (available / natural) * maxSize);
}
