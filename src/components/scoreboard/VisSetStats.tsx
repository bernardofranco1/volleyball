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

const LOGO = { x: 890, y: 46, w: 140, h: 96 };
const CLUSTER = { x: 670.5, y: 185.5, w: 579.5, h: 179 };
const SMALL = { lx: 680.5, rx: 1155, y: 195.5, w: 85, h: 110, cap: 56 };
const BIG = { lx: 775.5, rx: 965.5, y: 195.5, w: 179, h: 159, cap: 96 };
const FLAG = { lx: 489.5, rx: 1300.5, y: 185.5, size: 130 };
const NAME = { cap: 52, y: 210, lRight: 465, rLeft: 1455, w: 430 };
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
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- board art asset
          <img
            src={logoUrl}
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
        ) : null}

        <TeamName side="left" name={board.teamA.name} />
        <TeamName side="right" name={board.teamB.name} />
        <Flag side="left" code={board.teamA.code} theme={theme} />
        <Flag side="right" code={board.teamB.code} theme={theme} />

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

function TeamName({ side, name }: { side: "left" | "right"; name: string }) {
  const left = side === "left";
  const capPx = name.length > 16 ? 36 : name.length > 12 ? 44 : NAME.cap;
  return (
    <div
      style={{
        position: "absolute",
        left: x(left ? NAME.lRight - NAME.w : NAME.rLeft),
        top: y(NAME.y),
        width: x(NAME.w),
        height: y(NAME.cap * 1.6),
        display: "flex",
        alignItems: "center",
        justifyContent: left ? "flex-end" : "flex-start",
        fontSize: cap(capPx),
        lineHeight: 1,
        letterSpacing: f(1),
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {name}
    </div>
  );
}

function Flag({
  side, code, theme,
}: { side: "left" | "right"; code: string; theme: VisBoardTheme }) {
  const src = flagSrc(code);
  return (
    <div
      style={{
        position: "absolute",
        left: x(side === "left" ? FLAG.lx : FLAG.rx),
        top: y(FLAG.y),
        width: x(FLAG.size),
        height: y(FLAG.size),
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        fontSize: cap(40),
        color: theme.ink,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- board art asset
        <img
          src={src}
          alt={code}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
