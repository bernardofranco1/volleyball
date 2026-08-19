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

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const cap = (capPx: number) => f(capPx / 0.72);

const WIN = { left: 192, right: 1728, bottom: 864 };
const RAIL = { lx: 20, rx: 1748, w: 152, stroke: 7 };
const CUR = { y: 124, h: 160, cap: 96.5 };
const SETS = { y: 304, h: 160, labelCap: 30, cap: 82.5 };
const HIST = { y0: 484, h: 80, pitch: 100, cap: 50 };
const SETPLATE = { x: 834, y: 904.5, w: 252, h: 135, labelCap: 44, cap: 86 };
const BAND = { y: 890, h: 190 };
/** The requested flag + code head (spec/35 W6). */
const HEAD = { y: 12, flagH: 74, codeY: 90, codeCap: 34 };

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
  const sideOf = (team: "A" | "B"): SideData => {
    const t = team === "A" ? board.teamA : board.teamB;
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
          <span style={{ fontSize: cap(SETPLATE.labelCap), lineHeight: 1, letterSpacing: f(1) }}>
            {board.status === "FINISHED" ? "FINAL" : "SET"}
          </span>
          {board.status !== "FINISHED" ? (
            <span
              style={{
                fontSize: cap(SETPLATE.cap),
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {board.currentSet ?? ""}
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
  return (
    <>
      {/* Requested head: borderless flag + FIVB code (spec/35 W6). */}
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(HEAD.y),
          width: x(RAIL.w),
          height: y(HEAD.flagH),
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- board art asset
          <img
            src={src}
            alt={data.code}
            // `contain`: the whole flag at its own ratio, never cropped (spec/36).
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: x(rx),
          top: y(HEAD.codeY),
          width: x(RAIL.w),
          textAlign: "center",
          fontSize: cap(HEAD.codeCap),
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
          fontSize: cap(CUR.cap),
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
            fontSize: cap(SETS.cap),
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
            fontSize: cap(HIST.cap),
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
function dots(remaining: number, base: number): boolean[] {
  const total = Math.max(base, remaining);
  // Filled = still available. The rail counts DOWN as the set is spent.
  return Array.from({ length: total }, (_, i) => i < remaining);
}

function Counters({
  side, data, theme,
}: { side: "left" | "right"; data: SideData; theme: VisBoardTheme }) {
  const left = side === "left";
  const groups: { label: string; filled: boolean[] }[] = [
    // The FIVB indoor per-set allowances (see FIVB_PER_SET): 2 / 6 / 2. The
    // time-out row used to draw a single pip, which is the BEACH allowance.
    { label: "CHALLENGE", filled: dots(data.challenges, 2) },
    { label: "SUBST", filled: dots(data.substitutions, 6) },
    { label: "TIME OUT", filled: dots(data.timeouts, 2) },
  ];
  return (
    <div
      style={{
        position: "absolute",
        ...(left ? { left: x(52) } : { right: x(52) }),
        top: y(BAND.y),
        width: x(760),
        height: y(BAND.h),
        display: "grid",
        gridTemplateColumns: "1fr 1.35fr 1fr",
        gap: x(20),
        alignContent: "start",
        paddingTop: y(22),
      }}
    >
      {groups.map((g) => (
        <div
          key={g.label}
          style={{
            display: "grid",
            gridTemplateRows: "auto auto",
            justifyItems: "center",
            rowGap: y(16),
          }}
        >
          <span
            style={{
              fontSize: cap(32),
              lineHeight: 1,
              letterSpacing: f(1),
              // "TIME OUT" must stay on one line — the master has no wrap.
              whiteSpace: "nowrap",
            }}
          >
            {g.label}
          </span>
          <span style={{ display: "flex", gap: x(9) }}>
            {g.filled.map((on, i) => (
              <span
                key={i}
                style={{
                  width: x(34),
                  height: x(34),
                  borderRadius: "50%",
                  border: `${f(4)} solid ${theme.ink}`,
                  background: on ? theme.ink : "transparent",
                }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
