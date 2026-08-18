"use client";

/**
 * VNL-style broadcast board for VIS-fed matches (spec/34).
 *
 * Rebuilt from the FIVB digital-scoreboard templates: SET label, the big
 * current-set score with sets-won hanging beneath it, both line-ups with a PTS
 * column, the set ladder down the middle, and the time-out / substitution /
 * challenge counters at the foot.
 *
 * GEOMETRY. Everything lives inside a 16:9 "stage" sized
 * `min(100vw, 100vh × 16/9)`, declared a size container. Every dimension is
 * then written in `cqw`/`cqh` — 1cqw = 1% of stage width — so the whole board
 * scales exactly, at any resolution, with no JS measurement and therefore no
 * flash of unscaled layout on a TV that boots into the page.
 *
 * BACKGROUND. `backgroundUrl` paints behind everything, with the CSS fallback
 * underneath it: a missing/404 image simply reveals the fallback rather than
 * breaking the board, so a venue can drop the hi-res artwork in at any time.
 */

import type { VisBoardData, VisBoardPlayer } from "@/lib/vis-live/board-data";
import {
  VIS_BOARD_THEME,
  type VisBoardTheme,
  flagSrc,
} from "@/components/scoreboard/vis-board-theme";

export { VIS_BOARD_THEME, type VisBoardTheme } from "@/components/scoreboard/vis-board-theme";

/** Design space of the reference templates. */
const W = 1920;
const H = 1080;

// Every length is a CONTAINER-query unit, never a percentage: `cqw`/`cqh`
// always resolve against the stage, while a percentage resolves against
// whatever the parent happens to be — so nested boxes (a jersey plate inside a
// row inside a column) silently collapsed. 1cqw = 1% of stage width.
/** Horizontal size/offset: design px → stage width units. */
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
/** Vertical size/offset: design px → stage height units. */
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
/** Font size / border width: design px → stage width units. */
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;

const ROMAN = ["I", "II", "III", "IV", "V"];

export interface VisBoardProps {
  board: VisBoardData;
  theme?: VisBoardTheme;
  /** Hi-res venue artwork; falls back to the built-in gradient when absent. */
  backgroundUrl?: string | null;
  /** Shown small and dim — "signal lost 90s ago" while VIS is unreachable. */
  notice?: string | null;
  /**
   * Venue-local kick-off from the schedule, used when the live feed carries no
   * date of its own (it usually doesn't — GetVolleyLive takes no Fields list).
   */
  scheduledFallback?: string | null;
}

export function VisBoard({
  board,
  theme = VIS_BOARD_THEME,
  backgroundUrl,
  notice,
  scheduledFallback,
}: VisBoardProps) {
  const live = board.status === "LIVE";
  const scheduled = board.scheduledLocal ?? scheduledFallback ?? null;
  // The top slot always says what the viewer is looking at: which set is being
  // played, that the match is over, or when it starts. An empty slot on a TV
  // reads as a broken feed.
  const setLabel =
    board.status === "FINISHED"
      ? "FINAL"
      : board.currentSet
        ? `SET ${board.currentSet}`
        : scheduled
          ? `${scheduled} · LOCAL`
          : "NOT STARTED";

  // Ladder height: at least three rows so the shape reads as a ladder before
  // anything is played, at most five (the longest indoor match). It grows
  // downward into free space, so adding a set never pushes anything else.
  const ladderRows = Math.min(5, Math.max(3, board.sets.length));

  return (
    <div
      className="fixed inset-0 grid place-items-center overflow-hidden"
      style={{
        background: theme.bg,
        fontFamily: theme.ff,
        color: theme.ink,
      }}
    >
      {/* Stage: 16:9, size container, so every child can use cqw/cqh. */}
      <div
        className="relative"
        style={{
          // Widest 16:9 box that fits: letterboxes on either axis.
          width: `min(100vw, ${((W / H) * 100).toFixed(4)}vh)`,
          aspectRatio: `${W} / ${H}`,
          containerType: "size",
          // Layer order: artwork over the built-in gradient, so a 404 on the
          // artwork reveals the gradient instead of a bare colour.
          backgroundImage: [
            backgroundUrl ? `url("${backgroundUrl}")` : null,
            // Evokes the template's sweeping bands without needing the asset.
            "radial-gradient(120% 90% at 8% 0%, rgba(228,19,43,0.30) 0%, rgba(228,19,43,0) 55%)",
            "radial-gradient(120% 90% at 92% 100%, rgba(41,86,196,0.34) 0%, rgba(41,86,196,0) 55%)",
            "radial-gradient(90% 70% at 50% 120%, rgba(228,19,43,0.22) 0%, rgba(228,19,43,0) 60%)",
            "linear-gradient(180deg, #0B1024 0%, #121A38 55%, #0B1024 100%)",
          ]
            .filter(Boolean)
            .join(","),
          backgroundSize: "cover, auto, auto, auto, auto",
          backgroundPosition: "center",
        }}
      >
        {/* The AVC scoreboard master carries no logo — the event mark lives on
            the set-break screen only. `logoUrl` is accepted for that screen. */}
        {/* SET n / FINAL */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: y(52),
            textAlign: "center",
            fontSize: board.currentSet || board.status === "FINISHED" ? f(58) : f(40),
            fontWeight: 800,
            letterSpacing: f(2),
            whiteSpace: "nowrap",
          }}
        >
          {setLabel}
        </div>

        {/* ── team identities ─────────────────────────────────────────── */}
        <TeamName
          side="left"
          name={board.teamA.name}
          code={board.teamA.code}
          theme={theme}
        />
        <TeamName
          side="right"
          name={board.teamB.name}
          code={board.teamB.code}
          theme={theme}
        />

        {/* SERVE rail + ball, on the serving side of the score block */}
        {live && board.serving ? (
          <ServeMark side={board.serving} theme={theme} />
        ) : null}

        {/* ── score plates ────────────────────────────────────────────────
            While play is on, the template's hierarchy is right: the big plates
            carry the running set, the small ones the sets won. Once the match
            is over that reads as a riddle — a big "25 23" over a small "3 0" —
            so the result takes the big plates and the last set's points fall
            back to the ladder, which already lists every set. */}
        <div
          style={{
            position: "absolute",
            left: x(731),
            top: y(128),
            width: x(452),
            height: y(206),
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: x(6),
            background: theme.accent,
            padding: x(5),
          }}
        >
          <Plate
            value={board.status === "FINISHED" ? board.setsWonA : board.scoreA}
            theme={theme}
            size={140}
          />
          <Plate
            value={board.status === "FINISHED" ? board.setsWonB : board.scoreB}
            theme={theme}
            size={140}
          />
        </div>
        {board.status !== "FINISHED" ? (
          <div
            style={{
              position: "absolute",
              left: x(804),
              top: y(338),
              width: x(306),
              height: y(140),
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: x(6),
              background: theme.accent,
              padding: x(5),
            }}
          >
            <Plate value={board.setsWonA} theme={theme} size={96} />
            <Plate value={board.setsWonB} theme={theme} size={96} />
          </div>
        ) : null}

        {/* ── line-ups + points ──────────────────────────────────────── */}
        <Lineup
          side="left"
          players={board.teamA.players}
          serving={live && board.serving === "A"}
          theme={theme}
        />
        <Lineup
          side="right"
          players={board.teamB.players}
          serving={live && board.serving === "B"}
          theme={theme}
        />

        {/* ── set ladder ─────────────────────────────────────────────── */}
        <Ladder rows={ladderRows} sets={board.sets} theme={theme} />

        {/* ── interruption counters ──────────────────────────────────── */}
        <Counters board={board} theme={theme} />

        {/* Pool / round, bottom-left; keeps the board self-identifying on a
            wall of screens. */}
        {board.poolName ? (
          <div
            style={{
              position: "absolute",
              left: x(40),
              bottom: y(28),
              fontSize: f(26),
              opacity: 0.75,
              letterSpacing: f(1),
            }}
          >
            {board.poolName}
          </div>
        ) : null}

        {notice ? (
          <div
            style={{
              position: "absolute",
              right: x(40),
              bottom: y(28),
              fontSize: f(22),
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

// ── pieces ───────────────────────────────────────────────────────────────────

function Plate({
  value,
  theme,
  size,
}: {
  value: number;
  theme: VisBoardTheme;
  size: number;
}) {
  return (
    <div
      style={{
        background: theme.plate,
        color: theme.plateInk,
        display: "grid",
        placeItems: "center",
        fontSize: f(size),
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
  );
}

function TeamName({
  side,
  name,
  code,
  theme,
}: {
  side: "left" | "right";
  name: string;
  code: string;
  theme: VisBoardTheme;
}) {
  const left = side === "left";
  return (
    <div
      style={{
        position: "absolute",
        left: left ? x(60) : undefined,
        right: left ? undefined : x(60),
        top: y(168),
        width: x(560),
        height: y(120),
        display: "flex",
        flexDirection: left ? "row" : "row-reverse",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: x(24),
      }}
    >
      <div
        style={{
          // Long names (e.g. "United States", "Dominican Republic") SHRINK
          // rather than truncate — an ellipsis on a venue TV reads as a fault.
          fontSize: f(name.length > 16 ? 46 : name.length > 11 ? 56 : 70),
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: f(1),
          textTransform: "uppercase",
          textAlign: left ? "right" : "left",
          overflow: "hidden",
          whiteSpace: "nowrap",
          flex: "1 1 auto",
        }}
      >
        {name}
      </div>
      {/* Flag on the white plate, per the master. Self-hosted assets
          (public/flags, spec/34 — TPE is deliberately the Olympic-committee
          flag); the 3-letter code stands in when no asset exists. */}
      <div
        style={{
          flex: "0 0 auto",
          width: x(118),
          height: y(112),
          background: theme.plate,
          color: "#101010",
          display: "grid",
          placeItems: "center",
          fontSize: f(40),
          fontWeight: 800,
          letterSpacing: f(1),
          overflow: "hidden",
        }}
      >
        {flagSrc(code) ? (
          // eslint-disable-next-line @next/next/no-img-element -- board art asset
          <img
            src={flagSrc(code)!}
            alt={code}
            style={{ width: x(96), height: y(76), objectFit: "cover" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement!.textContent = code;
            }}
          />
        ) : (
          code
        )}
      </div>
    </div>
  );
}

/** Vertical SERVE text on the serving side of the score block — plain white
 *  lettering per the AVC master (no filled rail; the ball marks the serving
 *  player's row in the line-up instead). */
function ServeMark({ side, theme }: { side: "A" | "B"; theme: VisBoardTheme }) {
  const left = side === "A";
  return (
    <div
      style={{
        position: "absolute",
        left: left ? x(688) : undefined,
        right: left ? undefined : x(688),
        top: y(128),
        width: x(36),
        height: y(206),
        color: theme.ink,
        display: "grid",
        placeItems: "center",
        fontSize: f(26),
        fontWeight: 700,
        letterSpacing: f(3),
      }}
    >
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
        SERVE
      </span>
    </div>
  );
}

function Ball({ style }: { style: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 48 48" style={style} aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#F5C518" stroke="#0B1024" strokeWidth="2" />
      <path
        d="M6 18c12-4 24-2 34 8M8 32c10-8 24-10 34-4M24 2c-6 12-6 32 2 44"
        fill="none"
        stroke="#0B1024"
        strokeWidth="2.5"
      />
    </svg>
  );
}

const ROW_TOP = 452;
const ROW_H = 91;

function Lineup({
  side,
  players,
  serving,
  theme,
}: {
  side: "left" | "right";
  players: VisBoardPlayer[];
  serving: boolean;
  theme: VisBoardTheme;
}) {
  const left = side === "left";
  // Six rows always, so the board's shape is constant before line-ups land.
  const rows = Array.from({ length: 6 }, (_, i) => players[i] ?? null);
  return (
    <>
      {/* names + jersey plates */}
      <div
        style={{
          position: "absolute",
          left: left ? x(108) : undefined,
          right: left ? undefined : x(108),
          top: y(ROW_TOP),
          width: x(470),
        }}
      >
        {rows.map((p, i) => (
          <div
            key={i}
            style={{
              height: y(ROW_H),
              display: "flex",
              flexDirection: left ? "row" : "row-reverse",
              alignItems: "center",
              gap: x(16),
              // Position 1 of the serving team is the server (FIVB 12.2).
              outline:
                serving && p?.position === 1 ? `${f(5)} solid ${theme.accent}` : undefined,
              outlineOffset: f(2),
              paddingInline: x(6),
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                width: x(66),
                height: y(62),
                border: `${f(4)} solid ${theme.ink}`,
                display: "grid",
                placeItems: "center",
                fontSize: f(38),
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                background: p?.isLibero ? "rgba(255,255,255,0.16)" : "transparent",
              }}
            >
              {p?.jersey ?? ""}
            </div>
            <div
              style={{
                flex: "1 1 auto",
                fontSize: f(38),
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: f(0.5),
                textAlign: left ? "left" : "right",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {p?.name ?? ""}
            </div>
            {/* The master marks the server with the ball at the row's inner
                end (both flex directions end toward the court centre). */}
            {serving && p?.position === 1 ? (
              <Ball style={{ flex: "0 0 auto", width: x(44), height: y(78) }} />
            ) : null}
          </div>
        ))}
      </div>

      {/* PTS column */}
      <div
        style={{
          position: "absolute",
          left: left ? x(653) : undefined,
          right: left ? undefined : x(653),
          top: y(ROW_TOP - 58),
          width: x(92),
        }}
      >
        <div
          style={{
            height: y(50),
            border: `${f(4)} solid ${theme.ink}`,
            display: "grid",
            placeItems: "center",
            fontSize: f(26),
            fontWeight: 800,
            letterSpacing: f(1),
          }}
        >
          PTS
        </div>
        {rows.map((p, i) => (
          <div
            key={i}
            style={{
              height: y(ROW_H),
              marginTop: i === 0 ? y(8) : 0,
              border: `${f(4)} solid ${theme.ink}`,
              borderTopWidth: i === 0 ? f(4) : 0,
              display: "grid",
              placeItems: "center",
              fontSize: f(38),
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p ? p.points : ""}
          </div>
        ))}
      </div>
    </>
  );
}

function Ladder({
  rows,
  sets,
  theme,
}: {
  rows: number;
  sets: VisBoardData["sets"];
  theme: VisBoardTheme;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x(806),
        top: y(494),
        width: x(308),
        display: "grid",
        // 5 × 50 design px keeps the longest ladder clear of the counters below.
        gridTemplateRows: `repeat(${rows}, ${y(50)})`,
      }}
    >
      {Array.from({ length: rows }, (_, i) => {
        const s = sets[i];
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              fontSize: f(40),
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ textAlign: "center" }}>{s ? s.scoreA : ""}</div>
            <div
              style={{
                width: x(66),
                textAlign: "center",
                fontSize: f(34),
                borderInline: `${f(5)} solid ${theme.accent}`,
                alignSelf: "stretch",
                display: "grid",
                placeItems: "center",
                opacity: 0.95,
              }}
            >
              {ROMAN[i] ?? i + 1}
            </div>
            <div style={{ textAlign: "center" }}>{s ? s.scoreB : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function Counters({
  board,
  theme,
}: {
  board: VisBoardData;
  theme: VisBoardTheme;
}) {
  const rows: {
    icon: React.ReactNode;
    a: number;
    b: number;
    label: string;
  }[] = [
    {
      icon: <StopwatchIcon />,
      a: board.teamA.timeouts,
      b: board.teamB.timeouts,
      label: "Time-outs this set",
    },
    {
      icon: <SubsIcon />,
      a: board.teamA.substitutions,
      b: board.teamB.substitutions,
      label: "Substitutions this set",
    },
    {
      icon: <ChallengeIcon />,
      a: board.teamA.challenges,
      b: board.teamB.challenges,
      label: "Challenges this set",
    },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: x(824),
        top: y(756),
        width: x(272),
        border: `${f(5)} solid ${theme.accent}`,
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          title={r.label}
          style={{
            height: y(86),
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            borderTop: i === 0 ? undefined : `${f(5)} solid ${theme.accent}`,
            fontSize: f(38),
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <div style={{ textAlign: "center" }}>{r.a}</div>
          <div style={{ width: x(70), display: "grid", placeItems: "center" }}>
            {r.icon}
          </div>
          <div style={{ textAlign: "center" }}>{r.b}</div>
        </div>
      ))}
    </div>
  );
}

const ICON_SIZE = { width: f(42), height: f(42) } as const;

function StopwatchIcon() {
  return (
    <svg viewBox="0 0 24 24" style={ICON_SIZE} aria-hidden="true" fill="currentColor">
      <path d="M9 1h6v2H9zM12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18m1 4v5h4v2h-6V8z" />
    </svg>
  );
}

function SubsIcon() {
  return (
    <svg viewBox="0 0 24 24" style={ICON_SIZE} aria-hidden="true" fill="currentColor">
      <path d="M3 8h13l-3.5-3.5L14 3l6 6-6 6-1.5-1.5L16 10H3zM21 16H8l3.5 3.5L10 21l-6-6 1-1h16z" />
    </svg>
  );
}

function ChallengeIcon() {
  return (
    <svg viewBox="0 0 24 24" style={ICON_SIZE} aria-hidden="true" fill="currentColor">
      <path d="M3 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2m15 4 5-3v10l-5-3z" />
    </svg>
  );
}
