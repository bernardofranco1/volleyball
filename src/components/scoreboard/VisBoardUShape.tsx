"use client";

/**
 * U-shape venue board (spec/34), rebuilt from the AVC master
 * (~/U-Shape-VW-AVC-Digital-Scoreboard-16-9.ai): two side rails and a bottom
 * band around a clean centre window where the venue's TV feed sits.
 *
 * SIDES ARE PHYSICAL, NOT A/B. The master carries no team names — the rails
 * label whatever the camera shows, so the left rail follows
 * `Set@NoTeamAtLeft` and the board swaps itself at every court switch.
 * Unknown side (pre-match) falls back to A-left.
 *
 * Each rail, top to bottom: big current-set points, the red SETS plate, and
 * four small boxes with that team's points in completed sets 1-4 (the fifth
 * set, if any, is the one on the big plate). The bottom band: CHALLENGE /
 * SUBST / TIME OUT counters per side as circles — outlined = available,
 * filled = used — and the red SET plate in the centre. Circle counts follow
 * the master (2/6/1) and grow only if the feed reports more used, so the
 * board never under-reports.
 *
 * The centre window is TRANSPARENT: in vMix/OBS a browser source keys the
 * feed through it. `windowFill="black"` paints it for standalone use. The
 * frame shape is one background layer with a clip-path frame cut, so the
 * artwork stays continuous around the corner.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";
import {
  VIS_BOARD_THEME,
  type VisBoardTheme,
} from "@/components/scoreboard/vis-board-theme";

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;

/** The centre window of the master: x 192-1728, y 0-864 (design px). */
const WIN = { left: 192, right: 1728, bottom: 864 };

interface SideData {
  score: number;
  sets: number;
  history: (number | null)[]; // points in completed sets 1-4
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
  /** "transparent" keys the TV feed through (vMix/OBS); "black" for standalone. */
  windowFill?: "transparent" | "black";
  notice?: string | null;
}) {
  // Physical mapping: left rail = the team on the camera's left.
  const aLeft = board.teamAAtLeft ?? true;

  const historyOf = (team: "A" | "B"): (number | null)[] => {
    const done = board.sets.filter((s) => s.winner !== null);
    return Array.from({ length: 4 }, (_, i) =>
      done[i] ? (team === "A" ? done[i].scoreA : done[i].scoreB) : null,
    );
  };
  const sideOf = (team: "A" | "B"): SideData => ({
    score: team === "A" ? board.scoreA : board.scoreB,
    sets: team === "A" ? board.setsWonA : board.setsWonB,
    history: historyOf(team),
    timeouts: (team === "A" ? board.teamA : board.teamB).timeouts,
    substitutions: (team === "A" ? board.teamA : board.teamB).substitutions,
    challenges: (team === "A" ? board.teamA : board.teamB).challenges,
  });
  const leftSide = sideOf(aLeft ? "A" : "B");
  const rightSide = sideOf(aLeft ? "B" : "A");

  // One polygon that is the FRAME (outer rect minus the window), so the
  // background artwork runs continuously around the cut.
  const frameClip = `polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, ${pct(WIN.right, W)} 0%, ${pct(WIN.right, W)} ${pct(WIN.bottom, H)}, ${pct(WIN.left, W)} ${pct(WIN.bottom, H)}, ${pct(WIN.left, W)} 0%, 0% 0%)`;

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
        {/* Frame artwork with the window cut out. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: frameClip,
            backgroundImage: [
              backgroundUrl ? `url("${backgroundUrl}")` : null,
              "radial-gradient(120% 90% at 8% 0%, rgba(255,0,44,0.30) 0%, rgba(255,0,44,0) 55%)",
              "radial-gradient(120% 90% at 92% 100%, rgba(41,86,196,0.34) 0%, rgba(41,86,196,0) 55%)",
              "radial-gradient(90% 70% at 50% 120%, rgba(255,0,44,0.22) 0%, rgba(255,0,44,0) 60%)",
              `linear-gradient(180deg, ${theme.bg} 0%, #0A1233 55%, ${theme.bg} 100%)`,
            ]
              .filter(Boolean)
              .join(","),
            backgroundSize: "cover, auto, auto, auto, auto",
            backgroundPosition: "center",
          }}
        />

        <Rail side="left" data={leftSide} theme={theme} />
        <Rail side="right" data={rightSide} theme={theme} />

        {/* ── bottom band ─────────────────────────────────────────────── */}
        <Counters side="left" data={leftSide} theme={theme} />
        <Counters side="right" data={rightSide} theme={theme} />

        {/* SET plate, centre. */}
        <div
          style={{
            position: "absolute",
            left: x(836),
            top: y(902),
            width: x(248),
            height: y(140),
            background: theme.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: x(16),
          }}
        >
          <span style={{ fontSize: f(48), fontWeight: 800, letterSpacing: f(1) }}>
            {board.status === "FINISHED" ? "FINAL" : "SET"}
          </span>
          {board.status !== "FINISHED" ? (
            <span
              style={{
                fontSize: f(86),
                fontWeight: 800,
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
              right: x(16),
              top: y(8),
              fontSize: f(20),
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
  side,
  data,
  theme,
}: {
  side: "left" | "right";
  data: SideData;
  theme: VisBoardTheme;
}) {
  const left = side === "left";
  const railX = (px: number) => (left ? { left: x(px) } : { right: x(px) });
  return (
    <>
      {/* Big current-set points. */}
      <div
        style={{
          position: "absolute",
          ...railX(21),
          top: y(128),
          width: x(150),
          height: y(150),
          border: `${f(7)} solid ${theme.accent}`,
          display: "grid",
          placeItems: "center",
          fontSize: f(104),
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: theme.ink,
        }}
      >
        {data.score}
      </div>
      {/* SETS plate. */}
      <div
        style={{
          position: "absolute",
          ...railX(21),
          top: y(305),
          width: x(150),
          height: y(158),
          background: theme.accent,
          display: "grid",
          gridTemplateRows: "auto 1fr",
          justifyItems: "center",
          padding: `${y(12)} 0`,
        }}
      >
        <span style={{ fontSize: f(30), fontWeight: 800, letterSpacing: f(2) }}>
          SETS
        </span>
        <span
          style={{
            fontSize: f(88),
            fontWeight: 800,
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
            ...railX(21),
            top: y(490 + i * 100),
            width: x(150),
            height: y(74),
            border: `${f(6)} solid ${theme.accent}`,
            display: "grid",
            placeItems: "center",
            fontSize: f(44),
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: theme.ink,
          }}
        >
          {v ?? ""}
        </div>
      ))}
    </>
  );
}

/** Counter dots — the master's counts (2/6/1), grown when the feed exceeds
 *  them so the board never under-reports a taken interruption. */
function dots(used: number, base: number): boolean[] {
  const total = Math.max(base, used);
  return Array.from({ length: total }, (_, i) => i < used);
}

function Counters({
  side,
  data,
  theme,
}: {
  side: "left" | "right";
  data: SideData;
  theme: VisBoardTheme;
}) {
  const left = side === "left";
  const groups: { label: string; filled: boolean[] }[] = [
    { label: "CHALLENGE", filled: dots(data.challenges, 2) },
    { label: "SUBST", filled: dots(data.substitutions, 6) },
    { label: "TIME OUT", filled: dots(data.timeouts, 1) },
  ];
  return (
    <div
      style={{
        position: "absolute",
        ...(left ? { left: x(40) } : { right: x(40) }),
        top: y(902),
        width: x(740),
        height: y(140),
        display: "grid",
        gridTemplateColumns: "1fr 1.3fr 1fr",
        gap: x(24),
      }}
    >
      {groups.map((g) => (
        <div
          key={g.label}
          style={{
            display: "grid",
            gridTemplateRows: "auto 1fr",
            justifyItems: "center",
            rowGap: y(14),
            paddingTop: y(14),
          }}
        >
          <span style={{ fontSize: f(34), fontWeight: 800, letterSpacing: f(1) }}>
            {g.label}
          </span>
          <span style={{ display: "flex", gap: x(10) }}>
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
