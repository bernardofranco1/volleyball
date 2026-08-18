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

/**
 * The masters' OWN background artwork, extracted losslessly from each .ai
 * file's "Background" layer (spec/35 W1; see
 * spec/reference/avc/extract-backgrounds.py). These are not approximations of
 * the venue branding — they ARE it, so nothing here may be re-drawn in CSS.
 */
export const AVC_BACKGROUND = {
  scoreboard: "/board-bg/avc-scoreboard.png",
  set: "/board-bg/avc-set.png",
  ushape: "/board-bg/avc-ushape.png",
} as const;

/**
 * The master's OWN artwork assets, cut from the .ai render (spec/35): the ball
 * and the three interruption icons, white-on-transparent so they tint with the
 * board's ink. Hand-drawn SVG stand-ins were measurably off against the
 * template, which is the whole reason these exist.
 */
export const MIKASA_BALL = "/board-art/mikasa-ball.png";
export const COUNTER_ICON = {
  timeout: "/board-art/icon-timeout.png",
  subs: "/board-art/icon-subs.png",
  challenge: "/board-art/icon-challenge.png",
} as const;

/** Self-hosted flag asset for a volleyball federation code (spec/34).
 *  TPE is deliberately the Chinese Taipei Olympic-committee flag. */
export function flagSrc(code: string): string | null {
  return /^[A-Z]{3}$/.test(code) ? `/flags/${code}.png` : null;
}
