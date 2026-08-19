"use client";

/**
 * The official FIVB/AVC set-break statistics screen (spec/34, geometry
 * spec/35 W7), measured from ~/AVC-VenueBrand-Set-RGB-16-9.ai. As with the
 * scoreboard: finished design, nothing here is a styling choice of ours.
 *
 * Measured constants (design px, 1920×1080):
 *   event mark       ≈ x 890 → 1030, y 46 → 142 (centred)
 *   score frame      x 670.5 → 1250, y 185.5 → 364.5
 *   small plates     680.5 & 1155, y 195.5, 85 × 110   (sets won)
 *   big plates       775.5 & 965.5, y 195.5, 179 × 159 (the ended set)
 *   flags            489.5 & 1300.5, y 185.5, 130 × 130 — borderless
 *   team names       cap 52
 *   stats block      x 80 → 1840.5, y 410 → 996
 *   value plates     x 90 & 1696.5, 134 × 134, rows y 420/564/708/852 (pitch 144)
 *   labels           cap 43   ·   value digits cap 46.5
 *
 * The venue rotation (VisBoardDisplay) shows this screen 10 seconds after a
 * set ends and snaps back to the scoreboard when the next set begins.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";
import {
  AVC_BACKGROUND,
  AVC_MARK,
  VIS_BOARD_THEME,
  type VisBoardTheme,
} from "@/components/scoreboard/vis-board-theme";
import {
  TeamFlag,
  TeamMark,
  type TeamMarkGeometry,
} from "@/components/scoreboard/VisTeamMark";

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const cap = (capPx: number) => f(capPx / 0.72);

/** Measured from the master by keying the mark layer off the background:
 *  glyph box x 914 -> 1006, y 49 -> 137. */
const LOGO = { x: 914, y: 49, w: 92, h: 88 };
/** The set the big plates belong to, named just above them. The master leaves
 *  this band empty because its dummy state has no set to name (spec/37). */
const SETLABEL = { y: 145, cap: 27 };
const CLUSTER = { x: 670.5, y: 185.5, w: 579.5, h: 179 };
const SMALL = { lx: 680.5, rx: 1155, y: 195.5, w: 85, h: 110, cap: 56 };
const BIG = { lx: 775.5, rx: 965.5, y: 195.5, w: 179, h: 159, cap: 96 };
/** Head geometry (spec/36) — the scoreboard's rule on this master's numbers:
 *  the flag slot keeps the measured height, top and inner edge (619.5 / 1300.5)
 *  and widens outward to 195; the text box keeps the master's 35 px outer
 *  margin and its 24.5 px gap to the flag. See VisTeamMark. */
const MARK: TeamMarkGeometry = {
  text: { margin: 35, w: 306, centerY: 251.6, cap: 72, tracking: 1 },
  flag: { innerX: 619.5, w: 195, h: 130, y: 185.5, fit: "area" },
};
const BLOCK = { x: 80, y: 410, w: 1760.5, h: 586 };
const VALUE = { lx: 90, rx: 1696.5, size: 134, rowY0: 420, pitch: 144, cap: 46.5 };
const LABEL_CAP = 43;

export function VisSetStats({
  board,
  theme = VIS_BOARD_THEME,
  backgroundUrl,
  logoUrl,
  notice,
}: {
  board: VisBoardData;
  theme?: VisBoardTheme;
  backgroundUrl?: string | null;
  /** Event mark, top-centre (the AVC swirl on the master). */
  logoUrl?: string | null;
  notice?: string | null;
}) {
  const last = board.lastFinishedSet;
  const stats = board.stats;
  // Which set the big score belongs to: the one just played. Once the match is
  // over the plates carry the last set, and FINAL is the truthful label.
  const setLabel =
    board.status === "FINISHED"
      ? "FINAL"
      : last
        ? `SET ${last.setNumber}`
        : board.currentSet
          ? `SET ${board.currentSet}`
          : "";
  const rows: { label: string; a: number; b: number }[] = stats
    ? [
        { label: "ATTACKS", a: stats.attacksA, b: stats.attacksB },
        { label: "BLOCKS", a: stats.blocksA, b: stats.blocksB },
        { label: "SERVES", a: stats.servesA, b: stats.servesB },
        { label: "OPPONENT ERRORS", a: stats.opponentErrorsA, b: stats.opponentErrorsB },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 grid place-items-center overflow-hidden"
      style={{ background: theme.bg, fontFamily: theme.ff, color: theme.ink }}
    >
      <div
        className="relative"
        style={{
          width: `min(100vw, ${((W / H) * 100).toFixed(4)}vh)`,
          aspectRatio: `${W} / ${H}`,
          containerType: "size",
          backgroundColor: theme.bg,
          backgroundImage: [backgroundUrl, AVC_BACKGROUND.set]
            .filter(Boolean)
            .map((u) => `url("${u}")`)
            .join(","),
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* The master's own AVC mark, unless a competition supplies its own. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- board art asset */}
        <img
          src={logoUrl || AVC_MARK}
          alt=""
          style={{
            position: "absolute",
            left: x(LOGO.x),
            top: y(LOGO.y),
            width: x(LOGO.w),
            height: y(LOGO.h),
            objectFit: "contain",
          }}
        />

        {setLabel ? (
          <div
            style={{
              position: "absolute",
              left: x(960 - 300),
              width: x(600),
              top: y(SETLABEL.y),
              textAlign: "center",
              fontSize: cap(SETLABEL.cap),
              lineHeight: 1,
              letterSpacing: f(2),
              whiteSpace: "nowrap",
            }}
          >
            {setLabel}
          </div>
        ) : null}

        <TeamMark side="left" code={board.teamA.code} name={board.teamA.name} geo={MARK} />
        <TeamMark side="right" code={board.teamB.code} name={board.teamB.name} geo={MARK} />
        <TeamFlag side="left" code={board.teamA.code} theme={theme} geo={MARK} />
        <TeamFlag side="right" code={board.teamB.code} theme={theme} geo={MARK} />

        {/* Score cluster: sets won on the small outer plates, the just-ended
            set on the big central pair. */}
        <div
          style={{
            position: "absolute",
            left: x(CLUSTER.x),
            top: y(CLUSTER.y),
            width: x(CLUSTER.w),
            height: y(CLUSTER.h),
            background: theme.accent,
          }}
        />
        <PlateBox
          left={SMALL.lx} top={SMALL.y} w={SMALL.w} h={SMALL.h}
          capPx={SMALL.cap} value={board.setsWonA} theme={theme}
        />
        <PlateBox
          left={BIG.lx} top={BIG.y} w={BIG.w} h={BIG.h}
          capPx={BIG.cap} value={last ? last.scoreA : board.setsWonA} theme={theme}
        />
        <PlateBox
          left={BIG.rx} top={BIG.y} w={BIG.w} h={BIG.h}
          capPx={BIG.cap} value={last ? last.scoreB : board.setsWonB} theme={theme}
        />
        <PlateBox
          left={SMALL.rx} top={SMALL.y} w={SMALL.w} h={SMALL.h}
          capPx={SMALL.cap} value={board.setsWonB} theme={theme}
        />

        {/* Stats block: red ground with the row interiors and value plates
            knocked out of it. */}
        <div
          style={{
            position: "absolute",
            left: x(BLOCK.x),
            top: y(BLOCK.y),
            width: x(BLOCK.w),
            height: y(BLOCK.h),
            background: theme.accent,
          }}
        />
        {rows.map((r, i) => {
          const top = VALUE.rowY0 + i * VALUE.pitch;
          return (
            <div key={r.label}>
              <div
                style={{
                  position: "absolute",
                  left: x(VALUE.lx + VALUE.size),
                  top: y(top),
                  width: x(VALUE.rx - VALUE.lx - VALUE.size),
                  height: y(VALUE.size),
                  background: theme.bg,
                  display: "grid",
                  placeItems: "center",
                  fontSize: cap(LABEL_CAP),
                  lineHeight: 1,
                  letterSpacing: f(2),
                }}
              >
                {r.label}
              </div>
              {/* The LEADING side's number sits on red — the block's own
                  ground showing through — the trailing side's on a white
                  plate. A tie leaves both white: neither leads. */}
              <ValueCell value={r.a} leading={r.a > r.b} left={VALUE.lx} top={top} theme={theme} />
              <ValueCell value={r.b} leading={r.b > r.a} left={VALUE.rx} top={top} theme={theme} />
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div
            style={{
              position: "absolute",
              left: x(VALUE.lx),
              top: y(VALUE.rowY0),
              width: x(VALUE.rx + VALUE.size - VALUE.lx),
              height: y(VALUE.size),
              background: theme.bg,
              display: "grid",
              placeItems: "center",
              fontSize: cap(LABEL_CAP),
              letterSpacing: f(2),
            }}
          >
            STATISTICS NOT AVAILABLE
          </div>
        ) : null}

        {notice ? (
          <div
            style={{
              position: "absolute",
              right: x(28),
              bottom: y(14),
              fontSize: cap(20),
              opacity: 0.75,
              letterSpacing: f(1),
            }}
          >
            {notice}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ValueCell({
  value, leading, left, top, theme,
}: {
  value: number; leading: boolean; left: number; top: number; theme: VisBoardTheme;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x(left),
        top: y(top),
        width: x(VALUE.size),
        height: y(VALUE.size),
        background: leading ? theme.accent : theme.plate,
        color: leading ? theme.ink : theme.bg,
        display: "grid",
        placeItems: "center",
        fontSize: cap(VALUE.cap),
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
  );
}

function PlateBox({
  left, top, w, h, capPx, value, theme,
}: {
  left: number; top: number; w: number; h: number;
  capPx: number; value: number; theme: VisBoardTheme;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x(left), top: y(top), width: x(w), height: y(h),
        background: theme.plate,
        color: theme.plateInk,
        display: "grid",
        placeItems: "center",
        fontSize: cap(capPx),
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
  );
}

