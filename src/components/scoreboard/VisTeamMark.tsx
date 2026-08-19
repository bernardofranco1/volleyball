"use client";

/**
 * The team mark on the VIS boards: 3-letter code + flag (spec/36).
 *
 * TWO CHANGES to what the masters draw, both requested and both confined to
 * this module so the rest of the measured geometry stays untouched:
 *
 *   1. The head shows the team's OFFICIAL IOC 3-LETTER CODE, not the federation
 *      name. The masters' own names ("BRAZIL", "JAPAN") are short enough to sit
 *      at cap 52; real AVC entries are not — "KAZAKHSTAN" needs 502 design px
 *      in a 430 px box, "CHINESE TAIPEI" 467, "HONG KONG, CHINA" 613 — so the
 *      board either clipped them or shrank them to unreadable. A code is three
 *      glyphs, always fits at the master's cap, and is what the federations are
 *      identified by anyway. The full name remains the fallback for the rare
 *      payload with no code, fitted by measurement (see board-text-fit.ts).
 *
 *   2. Flags are shown WHOLE. The masters place a 130 x 130 square and the
 *      board filled it with `object-fit: cover`, which crops every flag that
 *      is not square — i.e. all of them: it cut the hoist off Brazil's 10:7 and
 *      a third off Kazakhstan's 2:1. The slot keeps the master's height and the
 *      master's INNER edge (the flag-to-score-frame relationship that carries
 *      the composition); it widens outward, into space the short code frees.
 */

import { fitCap } from "@/lib/board-text-fit";
import { DEFAULT_FLAG_RATIO, FLAG_RATIO } from "@/lib/board-flag-ratios";
import { flagSrc, type VisBoardTheme } from "@/components/scoreboard/vis-board-theme";

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
/** Measured values are CAP heights; Ancorli's cap is 0.70 em. */
const cap = (capPx: number) => f(capPx / 0.72);
/** Same optical-centring correction the boards apply to every measured cap. */
const NUDGE = 0.087;
const nudge = (capPx: number) => `translateY(${y(capPx * NUDGE)})`;

/** Per-board geometry, in design px of the 1920 x 1080 frame. */
export interface TeamMarkGeometry {
  /** Text box: distance of its OUTER edge from the board edge, its width, the
   *  optical CENTRE it hangs from (the master's own box centre), the cap height
   *  and the per-character tracking. Anchoring on the centre rather than the
   *  top means changing `cap` resizes the mark in place instead of dropping it
   *  down the board. */
  text: { margin: number; w: number; centerY: number; cap: number; tracking: number };
  /**
   * Flag slot. `innerX` is the LEFT side's inner edge — the one nearest the
   * score frame, which never moves; the flag grows outward from it and is
   * centred on `y + h / 2`. The right side is the mirror.
   *
   * `w` x `h` is the size BUDGET, and `fit` decides what the budget means,
   * because the assets are not one shape: 3:2 for most federations, 2:1 for
   * six, 10:7 Brazil, 28:11 Qatar.
   *   contain — fit inside the box. Widths match, heights do not.
   *   height  — every flag `h` tall. Heights match, widths do not.
   *   area    — every flag covers `w * h`. Neither matches; visual weight does.
   */
  flag: { innerX: number; w: number; h: number; y: number; fit: FlagFit };
}

/** The team's IOC code, or the full name fitted to the box when VIS sends none. */
export function TeamMark({
  side, code, name, geo,
}: {
  side: "left" | "right";
  code: string;
  name: string;
  geo: TeamMarkGeometry;
}) {
  const left = side === "left";
  const { margin, w, centerY, cap: maxCap, tracking } = geo.text;
  const boxH = maxCap * 1.6;
  const text = /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : name.toUpperCase();
  // A code always fits, so this only ever shrinks the name fallback.
  const capPx = fitCap(text, w, maxCap, tracking);
  return (
    <div
      style={{
        position: "absolute",
        left: x(left ? margin : W - margin - w),
        top: y(centerY - boxH / 2),
        width: x(w),
        height: y(boxH),
        display: "flex",
        alignItems: "center",
        // Both marks read inwards, towards the flag and the score — as the
        // masters set them.
        justifyContent: left ? "flex-end" : "flex-start",
        fontSize: cap(capPx),
        lineHeight: 1,
        letterSpacing: f(tracking),
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        transform: nudge(capPx),
      }}
    >
      {text}
    </div>
  );
}

export type FlagFit = "contain" | "height" | "area";

/** The rendered size of one flag under the chosen rule, in design px. */
export function flagBox(
  code: string,
  { w, h, fit }: { w: number; h: number; fit: FlagFit },
): { w: number; h: number } {
  const ratio = FLAG_RATIO[code.toUpperCase()] ?? DEFAULT_FLAG_RATIO;
  if (fit === "height") return { w: h * ratio, h };
  if (fit === "area") {
    const width = Math.sqrt(w * h * ratio);
    return { w: width, h: width / ratio };
  }
  return ratio >= w / h ? { w, h: w / ratio } : { w: h * ratio, h };
}

/** The whole flag, at its own proportions — never cropped. */
export function TeamFlag({
  side, code, theme, geo,
}: {
  side: "left" | "right";
  code: string;
  theme: VisBoardTheme;
  geo: TeamMarkGeometry;
}) {
  const { innerX, y: top, h } = geo.flag;
  const box = flagBox(code, geo.flag);
  const src = flagSrc(code);
  return (
    <div
      style={{
        position: "absolute",
        // The masters are symmetric about the centre line, so the right slot is
        // the left one mirrored. Whatever the flag's shape, its INNER edge — the
        // gap into the score frame — stays on the master's number.
        left: x(side === "left" ? innerX - box.w : W - innerX),
        top: y(top + (h - box.h) / 2),
        width: x(box.w),
        height: y(box.h),
        display: "grid",
        placeItems: "center",
        fontSize: cap(40),
        color: theme.ink,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- board art asset
        <img
          src={src}
          alt={code}
          style={{ width: "100%", height: "100%", display: "block" }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.parentElement!.textContent = code;
          }}
        />
      ) : (
        code
      )}
    </div>
  );
}
