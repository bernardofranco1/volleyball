"use client";

import { useEffect, useRef, useState } from "react";
import { teamSwatch } from "@/lib/colors";

// Broadcast scoreboard board — a faithful React port of the beach/air/grass
// design template (spec/change-requests/scoreboards). 1920×1080 stage scaled to
// fit any screen. Themed entirely through CSS tokens (--bg/--line/--font/
// --accent/--ff/--radius) so white-label colors drive it. Indoor reuses this
// board too (the template's per-player roster needs per-player stats the engine
// doesn't track — see spec/15 §4).

export interface BoardTheme {
  bg: string;
  line: string;
  font: string;
  accent: string;
  ff: string;
  radius: string;
}

export const DEFAULT_BOARD_THEME: BoardTheme = {
  bg: "#0E1A2B",
  line: "#F2A01E",
  font: "#FFFFFF",
  accent: "#F2A01E",
  ff: "'Saira Condensed','Barlow Condensed',system-ui,sans-serif",
  radius: "0px",
};

export interface BoardSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  /** 'A' | 'B' | null — who won the set (for the underline), null if in progress */
  winner: "A" | "B" | null;
}

export interface BoardProps {
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  setsWonA: number;
  setsWonB: number;
  scoreA: number;
  scoreB: number;
  serving: "A" | "B" | null;
  setNumber: number | null;
  sets: BoardSet[];
  logoUrl: string | null;
  finished: boolean;
  theme: BoardTheme;
}

/** Fit the fixed 1920×1080 stage into the viewport, preserving aspect ratio. */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const recompute = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);
  return scale;
}

export function BroadcastBoard(props: BoardProps) {
  const scale = useStageScale();
  const t = props.theme;
  const rootRef = useRef<HTMLDivElement>(null);
  const swatchA = teamSwatch(props.teamAColor, t.bg);
  const swatchB = teamSwatch(props.teamBColor, t.bg);
  const bar = (s: { color: string; border: string }): React.CSSProperties => ({
    width: 12,
    height: 64,
    flex: "none",
    borderRadius: 4,
    background: s.color,
    border: `2px solid ${s.border}`,
  });

  const cssVars = {
    "--bg": t.bg,
    "--line": t.line,
    "--font": t.font,
    "--accent": t.accent,
    "--ff": t.ff,
    "--radius": t.radius,
  } as React.CSSProperties;

  const serveDot = (team: "A" | "B") => (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: "50%",
        background: "var(--accent)",
        flex: "none",
        visibility: props.serving === team ? "visible" : "hidden",
      }}
    />
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...cssVars,
      }}
    >
      <div
        ref={rootRef}
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flex: "none",
          background: "var(--bg)",
          color: "var(--font)",
          fontFamily: "var(--ff)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 52,
          padding: "56px 64px",
          textTransform: "uppercase",
        }}
      >
        {/* TOP BAR: names + serve + sets-won */}
        <div
          style={{
            width: "100%",
            background: "var(--line)",
            display: "flex",
            gap: 6,
            padding: 6,
            borderRadius: "var(--radius)",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--bg)",
              display: "flex",
              alignItems: "center",
              gap: 26,
              padding: "16px 28px",
              borderRadius: "var(--radius)",
            }}
          >
            {serveDot("A")}
            <div style={bar(swatchA)} />
            <div
              style={{
                fontWeight: 700,
                fontSize: 56,
                letterSpacing: ".5px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {props.teamAName}
            </div>
          </div>
          <SetsWon value={props.setsWonA} />
          <SetsWon value={props.setsWonB} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 26,
              padding: "16px 28px",
              borderRadius: "var(--radius)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 56,
                letterSpacing: ".5px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                textAlign: "right",
              }}
            >
              {props.teamBName}
            </div>
            <div style={bar(swatchB)} />
            {serveDot("B")}
          </div>
        </div>

        {/* COMPETITION LOGO */}
        {props.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.logoUrl}
            alt=""
            style={{ maxWidth: 640, maxHeight: 150, objectFit: "contain" }}
          />
        ) : (
          <div style={{ height: 150 }} />
        )}

        {/* SET INDICATOR */}
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <div style={{ width: 54, height: 54, background: "var(--accent)", borderRadius: "var(--radius)" }} />
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: 3 }}>
            {props.finished ? "Final" : props.setNumber ? `Set ${props.setNumber}` : "—"}
          </div>
          <div style={{ width: 54, height: 54, background: "var(--accent)", borderRadius: "var(--radius)" }} />
        </div>

        {/* BIG SCORE + SET-BY-SET LADDER */}
        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            columnGap: 48,
          }}
        >
          <BigScore value={props.scoreA} />
          <Ladder sets={props.sets} />
          <BigScore value={props.scoreB} />
        </div>
      </div>
    </div>
  );
}

function SetsWon({ value }: { value: number }) {
  return (
    <div
      style={{
        width: 150,
        background: "var(--font)",
        color: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 116,
        fontWeight: 800,
        lineHeight: 1,
        borderRadius: "var(--radius)",
      }}
    >
      {value}
    </div>
  );
}

function BigScore({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 300, fontWeight: 800, lineHeight: 0.74 }}>{value}</div>
    </div>
  );
}

function Ladder({ sets }: { sets: BoardSet[] }) {
  if (sets.length === 0) return <div />;
  const underline = (won: boolean): React.CSSProperties =>
    won
      ? {
          textDecoration: "underline",
          textDecorationColor: "var(--accent)",
          textDecorationThickness: 6,
          textUnderlineOffset: 8,
        }
      : {};
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 800, lineHeight: 1 }}>
        {sets.map((s) => (
          <div
            key={s.setNumber}
            style={{
              height: 88,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              opacity: s.winner === null || s.winner === "A" ? 1 : 0.42,
              ...underline(s.winner === "A"),
            }}
          >
            {s.scoreA}
          </div>
        ))}
      </div>
      <div
        style={{
          border: "5px solid var(--accent)",
          borderRadius: "var(--radius)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontSize: 58,
          fontWeight: 800,
        }}
      >
        {sets.map((s, i) => (
          <div
            key={s.setNumber}
            style={{
              width: 88,
              height: 88,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: i < sets.length - 1 ? "5px solid var(--accent)" : undefined,
              background: s.winner === null ? "var(--accent)" : undefined,
              color: s.winner === null ? "var(--bg)" : undefined,
            }}
          >
            {s.setNumber}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 800, lineHeight: 1 }}>
        {sets.map((s) => (
          <div
            key={s.setNumber}
            style={{
              height: 88,
              display: "flex",
              alignItems: "center",
              opacity: s.winner === null || s.winner === "B" ? 1 : 0.42,
              ...underline(s.winner === "B"),
            }}
          >
            {s.scoreB}
          </div>
        ))}
      </div>
    </div>
  );
}
