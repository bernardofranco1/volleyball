/**
 * Fit a string of Ancorli into a fixed board box, arithmetically (spec/36).
 *
 * The VIS boards head each side with the team's 3-letter IOC code, which fits
 * the master's box at its measured cap of 52 with room to spare. This module
 * covers the fallback: when VIS sends no code the board falls back to the full
 * federation name, and "Chinese Taipei" or "Hong Kong, China" at cap 52 runs
 * off the plate. Shrink, never truncate — an ellipsis on a venue TV reads as a
 * fault.
 *
 * Widths come from the generated Ancorli table rather than a browser
 * measurement so the result is identical on the server and the client (the
 * boards are server-rendered; a JS fit pass would paint one size and jump) and
 * stable for the spec/35 pixel-diff gate.
 */

import { ANCORLI_METRICS } from "@/lib/board-text-metrics";

/** Absorbs the kerning the table omits (<1% on real names) plus rounding. */
const SAFETY = 0.985;

/**
 * Width of `text` expressed in CAP HEIGHTS — the boards' unit. Multiply by a
 * cap size in design px to get the rendered width, ignoring letter-spacing.
 */
export function widthInCaps(text: string): number {
  const { advance, fallbackAdvance, capHeight } = ANCORLI_METRICS;
  let units = 0;
  for (const ch of text) units += advance[ch] ?? fallbackAdvance;
  return units / capHeight;
}

/**
 * The largest cap height (design px) at which `text` fits `boxWidth`, capped at
 * `maxCap`. `letterSpacing` is the board's per-character tracking in design px.
 */
export function fitCap(
  text: string,
  boxWidth: number,
  maxCap: number,
  letterSpacing = 0,
): number {
  const upper = text.toUpperCase();
  const tracking = letterSpacing * Math.max(0, upper.length - 1);
  const available = (boxWidth - tracking) * SAFETY;
  const caps = widthInCaps(upper);
  if (caps <= 0 || available <= 0) return maxCap;
  return Math.min(maxCap, available / caps);
}
