"use client";

/**
 * The official FIVB/AVC U-shape venue board (spec/34, geometry spec/35 W6),
 * measured from ~/U-Shape-VW-AVC-Digital-Scoreboard-16-9.ai: two side rails
 * and a bottom band around a clean centre window for the venue's TV feed.
 *
 * Measured constants (design px, 1920×1080):
 *   centre window    x 192 → 1728, y 0 → 864   (exactly 1536 × 864)
 *   rail boxes       x 20 & 1748, w 152
 *   current set      y 124, h 160 (red outline)      digit cap 96.5
 *   SETS plate       y 304, h 160 (red fill)          digit cap 82.5
 *   set history      y 484 / 584 / 684 / 784, h 80 (pitch 100), digit cap 50
 *   SET plate        x 834, y 904.5, 252 × 135
 *
 * SIDES ARE PHYSICAL, NOT A/B. The master carries no team names, because the
 * rails label whatever the camera shows: the left rail follows
 * `Set@NoTeamAtLeft`, so the board swaps itself at every court switch.
 * Unknown side (pre-match) falls back to A-left.
 *
 * ADDITION (spec/35 W6, explicitly requested): a borderless flag and the
 * 3-letter FIVB code at the head of each rail, above the current-set box.
 * This is the one element the master does not prescribe.
 *
 * The centre window is TRANSPARENT so a vMix/OBS browser source keys the feed
 * through it; `windowFill="black"` paints it for standalone use. The frame is
 * one background layer with the window clipped out, so the artwork stays
 * continuous around the corner.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";
import {
  AVC_BACKGROUND,
  VIS_BOARD_THEME,
  type VisBoardTheme,
  flagSrc,
} from "@/components/scoreboard/vis-board-theme";
import { fitCap } from "@/lib/board-text-fit";
import { DEFAULT_FLAG_RATIO, FLAG_RATIO } from "@/lib/board-flag-ratios";

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const cap = (capPx: number) => f(capPx / 0.72);

const WIN = { left: 192, right: 1728, bottom: 864 };
const RAIL = { lx: 20, rx: 1748, w: 152, stroke: 7 };
/**
 * Rail geometry, rebalanced (spec/39). The previous figures overflowed at both
 * ends: a two-digit score ran past its box on every side, the flag was clipped
 * by the top of the frame, and the code sat on the score box's border. The
 * scores and sets boxes each give back 20 px of height, which is what buys the
 * flag room to show whole; every number is then fitted to its box rather than
 * set at a fixed cap, so nothing can overflow whatever the score reaches.
 */
const HEAD = { y: 10, flagH: 66, keyline: 2.5, codeY: 80, codeH: 48, codeCap: 34 };
const CUR = { y: 132, h: 140, cap: 70 };
const SETS = { y: 284, h: 140, labelCap: 26, cap: 62 };
const HIST = { y0: 442, h: 88, pitch: 108, cap: 56 };
const SETPLATE = { x: 834, y: 904.5, w: 252, h: 135, labelCap: 44, cap: 86 };
/**
 * The interruption band (spec/39). Sized so the three groups clear the centre
 * set plate at x 834-1086 on both sides: 40 + 756 = 796, and its mirror starts
 * at 1124. The labels came down from cap 32, which ran "TIME OUT" into the
 * plate.
 */
const BAND = { y: 890, h: 190, margin: 40, w: 756, gap: 24, padTop: 20, labelCap: 24 };
/** One allowance pip. Two rows of four fit the band at this size. */
const PIP = { size: 30, gap: 9, stroke: 4 };
/** Pips drawn per group — the allowance, not what is left. */
export const ALLOWANCE = { challenges: 2, substitutions: 8, timeouts: 2 };
/** Usable width inside a rail box, once its stroke and a little air are off. */
const RAIL_TEXT_W = RAIL.w - 2 * RAIL.stroke - 10;

/**
 * A cap that keeps `text` inside a rail box, never larger than the design's.
 *
 * The caps above are already chosen for the WIDEST string each box can hold —
 * a two-digit score at CUR.cap measures 125 px in a 128 px interior — because a
 * size that shrank to fit would make the score visibly jump as it crossed 9 to
 * 10, and a venue screen that changes type size mid-rally reads as broken. So
 * this is the safety net, not the normal path: it catches the payload nobody
 * planned for (a three-digit score, a four-letter code) rather than sizing the
 * ordinary case.
 */
const railCap = (text: string, maxCap: number) =>
  fitCap(text, RAIL_TEXT_W, maxCap);

interface SideData {
  code: string;
  score: number;
  sets: number;
  history: (number | null)[];
  timeouts: number;
  substitutions: number;
  challenges: number;
}

export function VisBoardUShape({
  board,
  theme = VIS_BOARD_THEME,
  backgroundUrl,
  windowFill = "transparent",
  notice,
}: {
  board: VisBoardData;
  theme?: VisBoardTheme;
  backgroundUrl?: string | null;
  /** "transparent" keys the TV feed through (vMix/OBS); "black" standalone. */
  windowFill?: "transparent" | "black";
  notice?: string | null;
}) {
  const aLeft = board.teamAAtLeft ?? true;

  const historyOf = (team: "A" | "B"): (number | null)[] => {
    const done = board.sets.filter((s) => s.winner !== null);
    return Array.from({ length: 4 }, (_, i) =>
      done[i] ? (team === "A" ? done[i].scoreA : done[i].scoreB) : null,
    );
  };
  // Before the first whistle no allowance has been spent, but VIS has no set
  // row to say so and the board falls back to the FIVB figure — which drew two
  // substitutions as already used on an event that allows eight. Nothing has
  // been used yet is the truthful reading (spec/39).
  const notStarted = board.status === "UPCOMING" || board.sets.length === 0;
  const sideOf = (team: "A" | "B"): SideData => {
    const t = team === "A" ? board.teamA : board.teamB;
    if (notStarted) {
      return {
        code: t.code,
        score: team === "A" ? board.scoreA : board.scoreB,
        sets: team === "A" ? board.setsWonA : board.setsWonB,
        history: historyOf(team),
        timeouts: ALLOWANCE.timeouts,
        substitutions: ALLOWANCE.substitutions,
        challenges: ALLOWANCE.challenges,
      };
    }
    return {
      code: t.code,
      score: team === "A" ? board.scoreA : board.scoreB,
      sets: team === "A" ? board.setsWonA : board.setsWonB,
      history: historyOf(team),
      timeouts: t.timeoutsRemaining,
      substitutions: t.substitutionsRemaining,
      challenges: t.challengesRemaining,
    };
  };
  const leftSide = sideOf(aLeft ? "A" : "B");
  const rightSide = sideOf(aLeft ? "B" : "A");

  // The centre plate must never read as a bare "SET" (spec/39). Before the
  // first whistle VIS has no set row, so there is no number to show — the plate
  // says WARM UP, which is what the screen is actually showing at that point.
  const plateLabel =
    board.status === "FINISHED"
      ? "FINAL"
      : board.status === "UPCOMING" || board.currentSet == null
        ? "WARM UP"
        : "SET";
  const plateNumber =
    board.status === "FINISHED" || board.status === "UPCOMING"
      ? null
      : (board.currentSet ?? null);

  // One polygon that IS the frame (outer rect minus the window), so the
  // artwork runs continuously around the cut.
  const frameClip =
    `polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, ` +
    `${pct(WIN.right, W)} 0%, ${pct(WIN.right, W)} ${pct(WIN.bottom, H)}, ` +
    `${pct(WIN.left, W)} ${pct(WIN.bottom, H)}, ${pct(WIN.left, W)} 0%, 0% 0%)`;

  return (
    <div
      className="fixed inset-0 grid place-items-center overflow-hidden"
      style={{
        background: windowFill === "black" ? "#000000" : "transparent",
        fontFamily: theme.ff,
        color: theme.ink,
      }}
    >
      <div
        className="relative"
        style={{
          width: `min(100vw, ${((W / H) * 100).toFixed(4)}vh)`,
          aspectRatio: `${W} / ${H}`,
          containerType: "size",
        }}
      >
        {/* The master's own artwork, with the feed window clipped out. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: frameClip,
            backgroundColor: theme.bg,
            backgroundImage: [backgroundUrl, AVC_BACKGROUND.ushape]
              .filter(Boolean)
              .map((u) => `url("${u}")`)
              .join(","),
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />

        <Rail side="left" data={leftSide} theme={theme} />
        <Rail side="right" data={rightSide} theme={theme} />
        <Counters side="left" data={leftSide} theme={theme} />
        <Counters side="right" data={rightSide} theme={theme} />

        {/* SET plate, centre of the bottom band. */}
        <div
          style={{
            position: "absolute",
            left: x(SETPLATE.x),
            top: y(SETPLATE.y),
            width: x(SETPLATE.w),
            height: y(SETPLATE.h),
            background: theme.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: x(18),
          }}
        >
          <span
            style={{
              // The plate is 252 px wide and "WARM UP" is three glyphs longer
              // than "FINAL": fit the label rather than let it wrap out of the
              // plate. One line always — the master has no second one.
              fontSize: cap(
                fitCap(plateLabel, SETPLATE.w - 28 - (plateNumber ? 84 : 0), SETPLATE.labelCap, 1),
              ),
              lineHeight: 1,
              letterSpacing: f(1),
              whiteSpace: "nowrap",
            }}
          >
            {plateLabel}
          </span>
          {plateNumber ? (
            <span
              style={{
                fontSize: cap(SETPLATE.cap),
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {plateNumber}
            </span>
          ) : null}
        </div>

        {notice ? (
          <div
            style={{
              position: "absolute",
              left: x(WIN.left + 12),
              top: y(8),
              fontSize: cap(18),
              opacity: 0.7,
            }}
          >
            {notice}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function pct(px: number, of: number): string {
  return `${((px / of) * 100).toFixed(4)}%`;
}

function Rail({
  side, data, theme,
}: { side: "left" | "right"; data: SideData; theme: VisBoardTheme }) {
  const left = side === "left";
  const rx = left ? RAIL.lx : RAIL.rx;
  const src = flagSrc(data.code);
  // The flag is sized by its own ratio so the keyline wraps the flag itself and
  // nothing is cropped; the rail's width is the only cap.
  const ratio = FLAG_RATIO[data.code.toUpperCase()] ?? DEFAULT_FLAG_RATIO;
  const flagW = Math.min(RAIL.w - 20, HEAD.flagH * ratio);
  return (
    <>
      {/* Head: the whole flag inside a white keyline, then the code (spec/39).
          The keyline hugs the FLAG, not a fixed slot, so it reads as a flag on
          any ratio and against the artwork's dark bands. */}
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(HEAD.y),
          width: x(RAIL.w),
          height: y(HEAD.flagH),
          display: "grid",
          placeItems: "center",
        }}
      >
        {src ? (
          <span
            style={{
              display: "block",
              width: x(flagW),
              height: y(HEAD.flagH),
              border: `${f(HEAD.keyline)} solid ${theme.ink}`,
              boxSizing: "border-box",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- board art asset */}
            <img
              src={src}
              alt={data.code}
              style={{ width: "100%", height: "100%", display: "block" }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </span>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(HEAD.codeY),
          width: x(RAIL.w),
          height: y(HEAD.codeH),
          display: "grid",
          placeItems: "center",
          fontSize: cap(railCap(data.code, HEAD.codeCap)),
          lineHeight: 1,
          letterSpacing: f(2),
        }}
      >
        {data.code}
      </div>

      {/* Current-set points — red outline box. */}
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(CUR.y),
          width: x(RAIL.w),
          height: y(CUR.h),
          border: `${f(RAIL.stroke)} solid ${theme.accent}`,
          display: "grid",
          placeItems: "center",
          fontSize: cap(railCap(String(data.score), CUR.cap)),
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {data.score}
      </div>

      {/* SETS — red filled plate. */}
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(SETS.y),
          width: x(RAIL.w),
          height: y(SETS.h),
          background: theme.accent,
          display: "grid",
          gridTemplateRows: "auto 1fr",
          justifyItems: "center",
          paddingTop: y(10),
        }}
      >
        <span style={{ fontSize: cap(SETS.labelCap), lineHeight: 1, letterSpacing: f(2) }}>
          SETS
        </span>
        <span
          style={{
            fontSize: cap(railCap(String(data.sets), SETS.cap)),
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            alignSelf: "center",
          }}
        >
          {data.sets}
        </span>
      </div>

      {/* Completed sets 1-4. */}
      {data.history.map((v, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x(rx),
            top: y(HIST.y0 + i * HIST.pitch),
            width: x(RAIL.w),
            height: y(HIST.h),
            border: `${f(RAIL.stroke)} solid ${theme.accent}`,
            display: "grid",
            placeItems: "center",
            fontSize: cap(railCap(v == null ? "" : String(v), HIST.cap)),
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {v ?? ""}
        </div>
      ))}
    </>
  );
}

/** Counter dots — one pip per FIVB per-set allowance (challenge 2 / subst 6 /
 *  time-out 2), never showing fewer pips than the allowance. */
export function dots(remaining: number, base: number): boolean[] {
  const total = Math.max(base, remaining);
  // Filled = still available. The rail counts DOWN as the set is spent.
  return Array.from({ length: total }, (_, i) => i < remaining);
}

function Counters({
  side, data, theme,
}: { side: "left" | "right"; data: SideData; theme: VisBoardTheme }) {
  const left = side === "left";
  const groups: { label: string; filled: boolean[]; perRow: number }[] = [
    { label: "CHALLENGE", filled: dots(data.challenges, ALLOWANCE.challenges), perRow: 2 },
    // Eight, in two rows of four (spec/39). Eight is what the feed reports for
    // these events, and one row of eight forced the pips small enough to be
    // ambiguous from the stands.
    { label: "SUBST", filled: dots(data.substitutions, ALLOWANCE.substitutions), perRow: 4 },
    { label: "TIME OUT", filled: dots(data.timeouts, ALLOWANCE.timeouts), perRow: 2 },
  ];
  return (
    <div
      style={{
        position: "absolute",
        ...(left ? { left: x(BAND.margin) } : { right: x(BAND.margin) }),
        top: y(BAND.y),
        width: x(BAND.w),
        height: y(BAND.h),
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: x(BAND.gap),
        alignContent: "start",
        paddingTop: y(BAND.padTop),
      }}
    >
      {groups.map((g) => (
        <div
          key={g.label}
          style={{
            display: "grid",
            gridTemplateRows: "auto auto",
            justifyItems: "center",
            rowGap: y(14),
          }}
        >
          <span
            style={{
              fontSize: cap(BAND.labelCap),
              lineHeight: 1,
              letterSpacing: f(1),
              // "TIME OUT" must stay on one line — the master has no wrap.
              whiteSpace: "nowrap",
            }}
          >
            {g.label}
          </span>
          <span
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${g.perRow}, ${x(PIP.size)})`,
              gap: x(PIP.gap),
              justifyContent: "center",
            }}
          >
            {g.filled.map((on, i) => (
              <span
                key={i}
                style={{
                  width: x(PIP.size),
                  height: x(PIP.size),
                  borderRadius: "50%",
                  border: `${f(PIP.stroke)} solid ${theme.ink}`,
                  // Filled = still available; a spent one is left as an outline.
                  background: on ? theme.ink : "transparent",
                  boxSizing: "border-box",
                }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
