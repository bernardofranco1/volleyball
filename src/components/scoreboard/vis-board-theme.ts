/**
 * Theme tokens for the VIS-fed official boards (spec/34).
 *
 * Values are SAMPLED FROM THE AVC MASTER ARTWORK
 * (~/AVC-VenueBrand-Scoreboard-RGB-16-9.ai, rasterised and pixel-read on
 * 2026-08-18): accent #FF002C, deep navy ground #000827. These boards carry
 * FIVB/AVC venue branding — the palette is not a design choice of ours, and
 * per-competition overrides exist only to retheme for a DIFFERENT official
 * event (e.g. the VNL blue), never to improvise.
 *
 * Kept separate from the components so server pages can import tokens without
 * pulling a client component into their module graph.
 */

export interface VisBoardTheme {
  /** Page/letterbox behind the board. */
  bg: string;
  /** Score-plate fill (the artwork's white plates). */
  plate: string;
  /** Numerals on the white plates. */
  plateInk: string;
  /** Frames, rails, the SETS plate, the serving highlight. */
  accent: string;
  /** Text on the background. */
  ink: string;
  ff: string;
}

export const VIS_BOARD_THEME: VisBoardTheme = {
  bg: "#000827",
  plate: "#FFFFFF",
  plateInk: "#FF002C",
  accent: "#FF002C",
  ink: "#FFFFFF",
  ff: "var(--font-ancorli),var(--font-saira-condensed),var(--font-barlow-condensed),system-ui,sans-serif",
};

/** Self-hosted flag asset for a volleyball federation code (spec/34).
 *  TPE is deliberately the Chinese Taipei Olympic-committee flag. */
export function flagSrc(code: string): string | null {
  return /^[A-Z]{3}$/.test(code) ? `/flags/${code}.png` : null;
}
