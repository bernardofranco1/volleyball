"use client";

/**
 * Set-break statistics screen (spec/34), rebuilt from the AVC master
 * (~/AVC-VenueBrand-Set-RGB-16-9.ai): event mark top-centre, team names with
 * flag plates, a score cluster — sets won on the small outer plates, the score
 * of the set that just ended on the big central pair — and four full-width
 * bars: ATTACKS / BLOCKS / SERVES / OPPONENT ERRORS. Per the master, the
 * LEADING side's number sits on a red plate, the trailing on white; a tie gets
 * white on both (neither leads).
 *
 * The venue rotation (VisBoardDisplay) shows this screen 10 seconds after a
 * set ends and snaps back to the scoreboard the moment the next set begins.
 * Same 16:9 cqw/cqh stage as VisBoard.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";
import {
  VIS_BOARD_THEME,
  type VisBoardTheme,
  flagSrc,
} from "@/components/scoreboard/vis-board-theme";

const W = 1920;
const H = 1080;
const x = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;
const y = (px: number) => `${((px / H) * 100).toFixed(4)}cqh`;
const f = (px: number) => `${((px / W) * 100).toFixed(4)}cqw`;

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
          backgroundImage: [
            backgroundUrl ? `url("${backgroundUrl}")` : null,
            "radial-gradient(120% 90% at 8% 0%, rgba(255,0,44,0.28) 0%, rgba(255,0,44,0) 55%)",
            "radial-gradient(120% 90% at 92% 100%, rgba(41,86,196,0.34) 0%, rgba(41,86,196,0) 55%)",
            "radial-gradient(90% 70% at 50% 120%, rgba(255,0,44,0.20) 0%, rgba(255,0,44,0) 60%)",
            `linear-gradient(180deg, ${theme.bg} 0%, #0A1233 55%, ${theme.bg} 100%)`,
          ]
            .filter(Boolean)
            .join(","),
          backgroundSize: "cover, auto, auto, auto, auto",
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
              left: "50%",
              transform: "translateX(-50%)",
              top: y(36),
              height: y(110),
              width: "auto",
              objectFit: "contain",
            }}
          />
        ) : null}

        {/* ── header: names, flags, score cluster ─────────────────────── */}
        <TeamHalf side="left" code={board.teamA.code} name={board.teamA.name} theme={theme} />
        <TeamHalf side="right" code={board.teamB.code} name={board.teamB.name} theme={theme} />

        {/* Score cluster: small outer plates = sets won; the big central pair
            = the set that just ended (the match result once it is over). */}
        <div
          style={{
            position: "absolute",
            left: x(672),
            top: y(186),
            width: x(576),
            height: y(130),
            background: theme.accent,
            padding: x(5),
            display: "grid",
            gridTemplateColumns: `${x(96)} 1fr 1fr ${x(96)}`,
            gap: x(5),
          }}
        >
          <SmallPlate value={board.setsWonA} theme={theme} />
          <BigPlate value={last ? last.scoreA : board.setsWonA} theme={theme} />
          <BigPlate value={last ? last.scoreB : board.setsWonB} theme={theme} />
          <SmallPlate value={board.setsWonB} theme={theme} />
        </div>

        {/* ── the four stat bars ──────────────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            left: x(84),
            top: y(410),
            width: x(1752),
            border: `${f(6)} solid ${theme.accent}`,
          }}
        >
          {rows.map((r, i) => (
            <div
              key={r.label}
              style={{
                height: y(142),
                display: "grid",
                gridTemplateColumns: `${x(146)} 1fr ${x(146)}`,
                borderTop: i === 0 ? undefined : `${f(6)} solid ${theme.accent}`,
              }}
            >
              <ValuePlate value={r.a} leading={r.a > r.b} theme={theme} />
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  fontSize: f(54),
                  fontWeight: 700,
                  letterSpacing: f(2),
                }}
              >
                {r.label}
              </div>
              <ValuePlate value={r.b} leading={r.b > r.a} theme={theme} />
            </div>
          ))}
          {rows.length === 0 ? (
            <div
              style={{
                height: y(142),
                display: "grid",
                placeItems: "center",
                fontSize: f(40),
                fontWeight: 700,
                opacity: 0.7,
              }}
            >
              STATISTICS NOT AVAILABLE
            </div>
          ) : null}
        </div>

        {notice ? (
          <div
            style={{
              position: "absolute",
              right: x(40),
              bottom: y(24),
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

function TeamHalf({
  side,
  code,
  name,
  theme,
}: {
  side: "left" | "right";
  code: string;
  name: string;
  theme: VisBoardTheme;
}) {
  const left = side === "left";
  return (
    <div
      style={{
        position: "absolute",
        left: left ? x(84) : undefined,
        right: left ? undefined : x(84),
        top: y(186),
        width: x(560),
        height: y(130),
        display: "flex",
        flexDirection: left ? "row" : "row-reverse",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: x(26),
      }}
    >
      <div
        style={{
          // Same shrink-not-truncate rule as the scoreboard header.
          fontSize: f(name.length > 16 ? 44 : name.length > 11 ? 54 : 66),
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: f(1),
          overflow: "hidden",
          whiteSpace: "nowrap",
          textAlign: left ? "right" : "left",
          flex: "1 1 auto",
        }}
      >
        {name}
      </div>
      <div
        style={{
          flex: "0 0 auto",
          width: x(126),
          height: y(120),
          background: theme.plate,
          display: "grid",
          placeItems: "center",
          color: "#101010",
          fontSize: f(40),
          fontWeight: 800,
          overflow: "hidden",
        }}
      >
        {flagSrc(code) ? (
          // eslint-disable-next-line @next/next/no-img-element -- board art asset
          <img
            src={flagSrc(code)!}
            alt={code}
            style={{ width: x(102), height: y(82), objectFit: "cover" }}
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

function BigPlate({ value, theme }: { value: number; theme: VisBoardTheme }) {
  return (
    <div
      style={{
        background: theme.plate,
        color: theme.plateInk,
        display: "grid",
        placeItems: "center",
        fontSize: f(92),
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
  );
}

function SmallPlate({ value, theme }: { value: number; theme: VisBoardTheme }) {
  return (
    <div
      style={{
        background: theme.plate,
        color: theme.plateInk,
        display: "grid",
        placeItems: "center",
        fontSize: f(56),
        fontWeight: 800,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        alignSelf: "start",
        height: y(78),
      }}
    >
      {value}
    </div>
  );
}

function ValuePlate({
  value,
  leading,
  theme,
}: {
  value: number;
  leading: boolean;
  theme: VisBoardTheme;
}) {
  return (
    <div
      style={{
        background: leading ? theme.accent : theme.plate,
        color: leading ? theme.ink : theme.bg,
        display: "grid",
        placeItems: "center",
        fontSize: f(58),
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </div>
  );
}
