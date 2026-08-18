"use client";

/**
 * The official FIVB/AVC full-screen scoreboard (spec/34, geometry spec/35).
 *
 * EVERY number below is MEASURED from the Illustrator master
 * (~/AVC-VenueBrand-Scoreboard-RGB-16-9.ai) by scanline, not estimated —
 * see spec/reference/avc/{measure.py,scan.py,*.measure.json}. The template is
 * finished design: no element may be moved, resized or restyled here. If
 * something looks wrong the fix is to re-measure, never to nudge.
 *
 * Measured constants (design px in a 1920×1080 frame, y from the top):
 *   score frame      x 726.5 → 1193.5   y 128.25 → 343.25, stroke 12
 *   big plates       738.5 & 966.25, w 214.75, y 140.25, h 191, divider 12.75
 *   sets frame       x 800.75 → 1119.25, y 331.25 → 488.75, stroke 12
 *   sets plates      813 & 965.25, w 140.25, h 133.5
 *   big digits       cap 120.5   ·   sets digits cap 78
 *   flags            489.25 & 1301, y 171.5, 130 × 130 — NO plate, NO border
 *   team names       cap 52
 *   SERVE            vertical text at x ≈ 688 / 1213, spans the score frame
 *   player rows      jersey plate 73.5 at x 108.75 / 1737.5, y0 457.5,
 *                    pitch 93.2, border 10, name cap 28
 *   serving frame    462 × 98 at x 97 / 1361, stroke 5
 *   ball             52.5 ⌀ at x 575.5 / 1291.5
 *   PTS column       x 647.5 & 1168.5, w 103, y 381.75, border 10, pitch 93.2
 *   ladder rails     917.25 & 985.5 (stroke 10), y 488.75 → 736.25, pitch 62
 *   counters         x 823.75 → 1089, y 736.25 → 1011.25, stroke 10, pitch 88.25
 */

import type { VisBoardData, VisBoardPlayer } from "@/lib/vis-live/board-data";
import {
  AVC_BACKGROUND,
  COUNTER_ICON,
  MIKASA_BALL,
  VIS_BOARD_THEME,
  type VisBoardTheme,
  flagSrc,
} from "@/components/scoreboard/vis-board-theme";

export { VIS_BOARD_THEME, type VisBoardTheme } from "@/components/scoreboard/vis-board-theme";

const W = 1920;
const H = 1080;
// Container-query units, never percentages: they resolve against the stage at
// any nesting depth, so the board scales exactly with no JS measurement.
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
/** Measured values are CAP heights; Ancorli's cap is ~0.72em. */
const cap = (capPx: number) => f(capPx / 0.72);
/**
 * Optically centring text means centring its LINE BOX, and Ancorli's ascent is
 * taller than its descent, so a centred glyph sits high. Measured against the
 * master (spec/35 W8): the correction is a constant fraction of the cap height,
 * verified on both the 120.5-cap score digits (10.5 px) and the 52-cap team
 * names (4.5 px). Applied as a transform so it never affects layout.
 */
const NUDGE = 0.087;
const nudge = (capPx: number) => `translateY(${y(capPx * NUDGE)})`;

const ROMAN = ["I", "II", "III", "IV", "V"];

const SCORE = { x: 726.5, y: 128.25, w: 467, h: 215 };
const BIG_PLATE = { lx: 738.5, rx: 966.25, y: 140.25, w: 214.75, h: 191, cap: 120.5 };
const SETS = { x: 800.75, y: 331.25, w: 318.5, h: 157.5 };
const SETS_PLATE = { lx: 813, rx: 965.25, y: 343.25, w: 140.25, h: 133.5, cap: 78 };
const FLAG = { lx: 489.25, rx: 1301, y: 171.5, size: 130 };
const NAME = { cap: 52, y: 196, lRight: 453.5, rLeft: 1466.5, w: 430 };
const SERVE = { lx: 688.5, rx: 1213.5, w: 18, y: 188.5, h: 87.5, cap: 18 };
const ROW = { y0: 457.5, pitch: 93.2, plate: 73.5, border: 10, cap: 28 };
const JERSEY = { lx: 108.75, rx: 1737.5 };
const NAME_COL = { lx: 203.75, rx: 1690, w: 350 };
const FRAME = { lx: 97, rx: 1361, w: 462, h: 98, stroke: 5, dy: -12 };
const BALL = { lx: 575.5, rx: 1291.5, dy: 11, size: 52.5 };
const PTS = { lx: 647.5, rx: 1168.5, w: 103, y: 381.75, headerBottom: 443, border: 10, cap: 23 };
const LADDER = {
  railL: 917.25, railR: 985.5, stroke: 10, y: 488.75, h: 247.5,
  // Measured cap tops 509 / 571.5 / 633.5 / 695.5 and glyph centres 871 / 1041.5.
  rowPitch: 62.17, rowY0: 500, cap: 25, scoreLx: 871, scoreRx: 1041.5,
};
const COUNTERS = {
  x: 823.75, y: 736.25, w: 265.25, h: 275, stroke: 10,
  // Measured row interiors and divider bands — equal thirds put the dividers
  // 3-7 px low, which the diff showed as two solid mismatch bands.
  rows: [
    { top: 746.25, h: 78.25 },
    { top: 834.5, h: 78.25 },
    { top: 922.75, h: 78.5 },
  ],
  dividers: [824.5, 912.75],
  cap: 31.5,
  // The master's own icons, at their measured sizes.
  icon: {
    timeout: { w: 47.5, h: 55.5 },
    subs: { w: 68.5, h: 56.5 },
    challenge: { w: 53, h: 33.5 },
  },
};

export interface VisBoardProps {
  board: VisBoardData;
  theme?: VisBoardTheme;
  /** Overrides the official artwork (a venue's own plate, or `?bg=`). */
  backgroundUrl?: string | null;
  /** Small and dim, bottom-right: "no signal for 90s", or the mock marker. */
  notice?: string | null;
  /**
   * Replica mode for the pixel-diff gate (spec/35 W8) — the master's dummy
   * state frames BOTH first rows. Never true in production.
   */
  replica?: boolean;
}

export function VisBoard({
  board,
  theme = VIS_BOARD_THEME,
  backgroundUrl,
  notice,
  replica = false,
}: VisBoardProps) {
  const live = board.status === "LIVE";
  const finished = board.status === "FINISHED";
  // No date/time in this slot (spec/35 requirement 5).
  const setLabel = finished ? "FINAL" : board.currentSet ? `SET ${board.currentSet}` : "";
  const ladderRows = Math.min(5, Math.max(4, board.sets.length));

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
          // The master's OWN artwork; an override sits on top of it.
          backgroundColor: theme.bg,
          backgroundImage: [backgroundUrl, AVC_BACKGROUND.scoreboard]
            .filter(Boolean)
            .map((u) => `url("${u}")`)
            .join(","),
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Measured: cap 35.5, glyph run x 889.5 → 1021.5 (centre 955.5),
            cap top y 69. */}
        <div
          style={{
            position: "absolute",
            left: x(955.5 - 300),
            width: x(600),
            top: y(60),
            textAlign: "center",
            fontSize: cap(35.5),
            lineHeight: 1,
            letterSpacing: f(2),
            whiteSpace: "nowrap",
            transform: nudge(35.5),
          }}
        >
          {setLabel}
        </div>

        <TeamName side="left" name={board.teamA.name} />
        <TeamName side="right" name={board.teamB.name} />
        <Flag side="left" code={board.teamA.code} theme={theme} />
        <Flag side="right" code={board.teamB.code} theme={theme} />

        {/* SERVE: plain vertical lettering, no filled rail (the master has none). */}
        {live && board.serving ? (
          <div
            style={{
              position: "absolute",
              left: x(board.serving === "A" ? SERVE.lx : SERVE.rx),
              width: x(SERVE.w),
              top: y(SERVE.y),
              height: y(SERVE.h),
              display: "grid",
              placeItems: "center",
              fontSize: cap(SERVE.cap),
              lineHeight: 1,
            }}
          >
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              SERVE
            </span>
          </div>
        ) : null}

        {/* Score block: one red form with the plates knocked out of it. */}
        <Solid left={SCORE.x} top={SCORE.y} w={SCORE.w} h={SCORE.h} fill={theme.accent} />
        <Plate
          left={BIG_PLATE.lx} top={BIG_PLATE.y} w={BIG_PLATE.w} h={BIG_PLATE.h}
          capPx={BIG_PLATE.cap} value={finished ? board.setsWonA : board.scoreA} theme={theme}
        />
        <Plate
          left={BIG_PLATE.rx} top={BIG_PLATE.y} w={BIG_PLATE.w} h={BIG_PLATE.h}
          capPx={BIG_PLATE.cap} value={finished ? board.setsWonB : board.scoreB} theme={theme}
        />

        <Solid left={SETS.x} top={SETS.y} w={SETS.w} h={SETS.h} fill={theme.accent} />
        <Plate
          left={SETS_PLATE.lx} top={SETS_PLATE.y} w={SETS_PLATE.w} h={SETS_PLATE.h}
          capPx={SETS_PLATE.cap}
          // Once the match is over the big plates carry the result, so these
          // would repeat it; show the deciding set's points instead.
          value={finished ? (board.lastFinishedSet?.scoreA ?? 0) : board.setsWonA}
          theme={theme}
        />
        <Plate
          left={SETS_PLATE.rx} top={SETS_PLATE.y} w={SETS_PLATE.w} h={SETS_PLATE.h}
          capPx={SETS_PLATE.cap}
          value={finished ? (board.lastFinishedSet?.scoreB ?? 0) : board.setsWonB}
          theme={theme}
        />

        <Lineup
          side="left" players={board.teamA.players}
          serving={(live && board.serving === "A") || replica} theme={theme}
        />
        <Lineup
          side="right" players={board.teamB.players}
          serving={(live && board.serving === "B") || replica} theme={theme}
          replicaSecond={replica && board.serving !== "B"}
        />
        <PtsColumn side="left" players={board.teamA.players} theme={theme} />
        <PtsColumn side="right" players={board.teamB.players} theme={theme} />

        <Ladder rows={ladderRows} sets={board.sets} theme={theme} />
        <Counters board={board} theme={theme} />

        {notice ? (
          <div
            style={{
              position: "absolute",
              right: x(28),
              bottom: y(20),
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

// ── pieces ───────────────────────────────────────────────────────────────────

function Solid({
  left, top, w, h, fill,
}: { left: number; top: number; w: number; h: number; fill: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x(left), top: y(top), width: x(w), height: y(h), background: fill,
      }}
    />
  );
}

function Plate({
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
      {/* The nudge goes on the GLYPH: transforming the plate itself would move
          the white box off the master's measured position. */}
      <span style={{ transform: nudge(capPx), display: "block" }}>{value}</span>
    </div>
  );
}

function TeamName({ side, name }: { side: "left" | "right"; name: string }) {
  const left = side === "left";
  // Long names shrink rather than truncate — an ellipsis on a venue TV reads
  // as a fault. The master's own names sit at cap 52.
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
        transform: nudge(capPx),
      }}
    >
      {name}
    </div>
  );
}

/** 130 × 130, filling its box — no plate, no border (spec/35 W2). */
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

function Lineup({
  side, players, serving, theme, replicaSecond = false,
}: {
  side: "left" | "right";
  players: VisBoardPlayer[];
  serving: boolean;
  theme: VisBoardTheme;
  /** Replica-only: framed like the serving side but without the ball. */
  replicaSecond?: boolean;
}) {
  const left = side === "left";
  // Six rows in CURRENT rotation order: players[0] is position 1 right now
  // (spec/35 requirement 3), which is who serves when this team serves.
  const rows = Array.from({ length: 6 }, (_, i) => players[i] ?? null);
  return (
    <>
      {rows.map((p, i) => {
        const top = ROW.y0 + i * ROW.pitch;
        const isServer = serving && i === 0;
        // The master's dummy state frames BOTH first rows but draws the ball
        // once, on the serving side only.
        const showBall = isServer && !replicaSecond;
        return (
          <div key={i}>
            {isServer ? (
              <div
                style={{
                  position: "absolute",
                  left: x(left ? FRAME.lx : FRAME.rx),
                  top: y(top + FRAME.dy),
                  width: x(FRAME.w),
                  height: y(FRAME.h),
                  border: `${f(FRAME.stroke)} solid ${theme.accent}`,
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                left: x(left ? JERSEY.lx : JERSEY.rx),
                top: y(top),
                width: x(ROW.plate),
                height: y(ROW.plate),
                border: `${f(ROW.border)} solid ${theme.ink}`,
                display: "grid",
                placeItems: "center",
                fontSize: cap(ROW.cap),
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ transform: nudge(ROW.cap), display: "block" }}>
                {p?.jersey ?? ""}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                left: x(left ? NAME_COL.lx : NAME_COL.rx - NAME_COL.w),
                top: y(top),
                width: x(NAME_COL.w),
                height: y(ROW.plate),
                display: "flex",
                alignItems: "center",
                justifyContent: left ? "flex-start" : "flex-end",
                fontSize: cap(ROW.cap),
                lineHeight: 1,
                letterSpacing: f(0.5),
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                overflow: "hidden",
                transform: nudge(ROW.cap),
              }}
            >
              {p?.name ?? ""}
            </div>
            {showBall ? (
              // eslint-disable-next-line @next/next/no-img-element -- board art asset
              <img
                src={MIKASA_BALL}
                alt=""
                style={{
                  position: "absolute",
                  left: x(left ? BALL.lx : BALL.rx),
                  top: y(top + BALL.dy),
                  width: x(BALL.size),
                  height: y(BALL.size),
                }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function PtsColumn({
  side, players, theme,
}: { side: "left" | "right"; players: VisBoardPlayer[]; theme: VisBoardTheme }) {
  const left = side === "left";
  const rows = Array.from({ length: 6 }, (_, i) => players[i] ?? null);
  const colX = left ? PTS.lx : PTS.rx;
  const border = `${f(PTS.border)} solid ${theme.ink}`;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x(colX),
          top: y(PTS.y),
          width: x(PTS.w),
          height: y(PTS.headerBottom + PTS.border - PTS.y),
          border,
          display: "grid",
          placeItems: "center",
          fontSize: cap(PTS.cap),
          lineHeight: 1,
          letterSpacing: f(1),
        }}
      >
        <span style={{ transform: nudge(PTS.cap), display: "block" }}>PTS</span>
      </div>
      {rows.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x(colX),
            top: y(PTS.headerBottom + i * ROW.pitch),
            width: x(PTS.w),
            height: y(ROW.pitch + PTS.border),
            border,
            display: "grid",
            placeItems: "center",
            fontSize: cap(ROW.cap + 3),
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ transform: nudge(ROW.cap + 3), display: "block" }}>
            {p ? p.points : ""}
          </span>
        </div>
      ))}
    </>
  );
}

function Ladder({
  rows, sets, theme,
}: { rows: number; sets: VisBoardData["sets"]; theme: VisBoardTheme }) {
  const romanCx = (LADDER.railL + LADDER.railR + LADDER.stroke) / 2;
  return (
    <>
      <Solid
        left={LADDER.railL} top={LADDER.y} w={LADDER.stroke} h={LADDER.h} fill={theme.accent}
      />
      <Solid
        left={LADDER.railR} top={LADDER.y} w={LADDER.stroke} h={LADDER.h} fill={theme.accent}
      />
      {Array.from({ length: rows }, (_, i) => {
        const s = sets[i];
        const top = LADDER.rowY0 + i * LADDER.rowPitch;
        const cell = (val: string, cx: number, k: string) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: x(cx - 60),
              top: y(top),
              width: x(120),
              height: y(LADDER.cap * 1.7),
              display: "grid",
              placeItems: "center",
              fontSize: cap(LADDER.cap),
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              transform: nudge(LADDER.cap),
            }}
          >
            {val}
          </div>
        );
        return (
          <div key={i}>
            {cell(s ? String(s.scoreA) : "", LADDER.scoreLx, "a")}
            {cell(ROMAN[i] ?? String(i + 1), romanCx, "r")}
            {cell(s ? String(s.scoreB) : "", LADDER.scoreRx, "b")}
          </div>
        );
      })}
    </>
  );
}

function Counters({ board, theme }: { board: VisBoardData; theme: VisBoardTheme }) {
  const rows: { icon: React.ReactNode; a: number; b: number; label: string }[] = [
    {
      icon: <Icon src={COUNTER_ICON.timeout} size={COUNTERS.icon.timeout} />,
      a: board.teamA.timeouts, b: board.teamB.timeouts, label: "Time-outs this set",
    },
    {
      icon: <Icon src={COUNTER_ICON.subs} size={COUNTERS.icon.subs} />,
      a: board.teamA.substitutions, b: board.teamB.substitutions,
      label: "Substitutions this set",
    },
    {
      icon: <Icon src={COUNTER_ICON.challenge} size={COUNTERS.icon.challenge} />,
      a: board.teamA.challenges, b: board.teamB.challenges, label: "Challenges this set",
    },
  ];
  return (
    <>
      {/* Red ground, then the three row interiors knocked out of it — the
          dividers are simply the ground showing between them. */}
      <Solid
        left={COUNTERS.x} top={COUNTERS.y} w={COUNTERS.w} h={COUNTERS.h} fill={theme.accent}
      />
      {rows.map((r, i) => {
        const row = COUNTERS.rows[i];
        return (
          <div
            key={i}
            title={r.label}
            style={{
              position: "absolute",
              left: x(COUNTERS.x + COUNTERS.stroke),
              top: y(row.top),
              width: x(COUNTERS.w - 2 * COUNTERS.stroke),
              height: y(row.h),
              background: theme.bg,
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              fontSize: cap(COUNTERS.cap),
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ textAlign: "center", transform: nudge(COUNTERS.cap) }}>{r.a}</div>
            <div style={{ width: x(72), display: "grid", placeItems: "center" }}>{r.icon}</div>
            <div style={{ textAlign: "center", transform: nudge(COUNTERS.cap) }}>{r.b}</div>
          </div>
        );
      })}
    </>
  );
}

function Icon({ src, size }: { src: string; size: { w: number; h: number } }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- board art asset
    <img src={src} alt="" style={{ width: x(size.w), height: y(size.h) }} />
  );
}
