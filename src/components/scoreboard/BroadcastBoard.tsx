"use client";

import { teamSwatch } from "@/lib/colors";
import type { BoardTheme } from "@/lib/board-theme";

// Broadcast scoreboard board for Beach / Grass / Light — a React port of the
// beach design template (spec/change-requests/scoreboards). Fully fluid: it
// fills the viewport and sizes everything in `vmin`, so it scales and reflows
// across aspect ratios from 3:4 (portrait) to 16:9 (landscape). Themed through
// CSS tokens (--bg/--line/--font/--accent/--ff/--radius) from the competition's
// Scoreboard config. Indoor uses its own board.

export interface BoardSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  /** 'A' | 'B' | null — who won the set (underline); null if in progress. */
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

export function BroadcastBoard(props: BoardProps) {
  const t = props.theme;
  const swatchA = teamSwatch(props.teamAColor, t.bg);
  const swatchB = teamSwatch(props.teamBColor, t.bg);
  const bar = (s: { color: string; border: string }): React.CSSProperties => ({
    width: "1.1vmin",
    height: "6vmin",
    flex: "none",
    borderRadius: "0.4vmin",
    background: s.color,
    border: `0.2vmin solid ${s.border}`,
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
        width: "4.2vmin",
        height: "4.2vmin",
        borderRadius: "50%",
        background: "var(--accent)",
        flex: "none",
        visibility: props.serving === team ? "visible" : "hidden",
      }}
    />
  );

  const namePanel = (
    name: string,
    team: "A" | "B",
    swatch: { color: string; border: string },
  ) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: team === "B" ? "flex-end" : "flex-start",
        gap: "2.4vmin",
        padding: "1.5vmin 2.6vmin",
        borderRadius: "var(--radius)",
      }}
    >
      {team === "A" ? (
        <>
          {serveDot("A")}
          <div style={bar(swatch)} />
        </>
      ) : null}
      <div
        style={{
          fontWeight: 700,
          fontSize: "5vmin",
          letterSpacing: ".5px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
          textAlign: team === "B" ? "right" : "left",
        }}
      >
        {name}
      </div>
      {team === "B" ? (
        <>
          <div style={bar(swatch)} />
          {serveDot("B")}
        </>
      ) : null}
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        color: "var(--font)",
        fontFamily: "var(--ff)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "4vmin",
        padding: "5vmin 6vmin",
        overflow: "hidden",
        textTransform: "uppercase",
        ...cssVars,
      }}
    >
      {/* TOP BAR: names + serve + sets-won */}
      <div
        style={{
          width: "100%",
          background: "var(--line)",
          display: "flex",
          gap: "0.6vmin",
          padding: "0.6vmin",
          borderRadius: "var(--radius)",
        }}
      >
        {namePanel(props.teamAName, "A", swatchA)}
        <SetsWon value={props.setsWonA} />
        <SetsWon value={props.setsWonB} />
        {namePanel(props.teamBName, "B", swatchB)}
      </div>

      {/* COMPETITION LOGO */}
      {props.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.logoUrl}
          alt=""
          style={{ maxWidth: "55vmin", maxHeight: "13vmin", objectFit: "contain" }}
        />
      ) : null}

      {/* SET INDICATOR */}
      <div style={{ display: "flex", alignItems: "center", gap: "3vmin" }}>
        <Square />
        <div style={{ fontSize: "7vmin", fontWeight: 800, letterSpacing: "0.3vmin" }}>
          {props.finished
            ? "Final"
            : props.setNumber
              ? `Set ${props.setNumber}`
              : "—"}
        </div>
        <Square />
      </div>

      {/* BIG SCORE + SET-BY-SET LADDER */}
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          columnGap: "4vmin",
        }}
      >
        <BigScore value={props.scoreA} />
        <Ladder sets={props.sets} />
        <BigScore value={props.scoreB} />
      </div>
    </div>
  );
}

function Square() {
  return (
    <div
      style={{
        width: "5vmin",
        height: "5vmin",
        background: "var(--accent)",
        borderRadius: "var(--radius)",
        flex: "none",
      }}
    />
  );
}

function SetsWon({ value }: { value: number }) {
  return (
    <div
      style={{
        width: "14vmin",
        flex: "none",
        background: "var(--font)",
        color: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11vmin",
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
      <div style={{ fontSize: "28vmin", fontWeight: 800, lineHeight: 0.74 }}>
        {value}
      </div>
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
          textDecorationThickness: "0.6vmin",
          textUnderlineOffset: "0.8vmin",
        }
      : {};
  const col = (pick: "A" | "B") => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        fontSize: "6vmin",
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {sets.map((s) => (
        <div
          key={s.setNumber}
          style={{
            height: "8vmin",
            display: "flex",
            alignItems: "center",
            justifyContent: pick === "A" ? "flex-end" : "flex-start",
            opacity: s.winner === null || s.winner === pick ? 1 : 0.42,
            ...underline(s.winner === pick),
          }}
        >
          {pick === "A" ? s.scoreA : s.scoreB}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2.4vmin" }}>
      {col("A")}
      <div
        style={{
          border: "0.5vmin solid var(--accent)",
          borderRadius: "var(--radius)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontSize: "5.4vmin",
          fontWeight: 800,
        }}
      >
        {sets.map((s, i) => (
          <div
            key={s.setNumber}
            style={{
              width: "8vmin",
              height: "8vmin",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom:
                i < sets.length - 1 ? "0.5vmin solid var(--accent)" : undefined,
              background: s.winner === null ? "var(--accent)" : undefined,
              color: s.winner === null ? "var(--bg)" : undefined,
            }}
          >
            {s.setNumber}
          </div>
        ))}
      </div>
      {col("B")}
    </div>
  );
}
