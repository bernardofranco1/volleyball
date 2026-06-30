"use client";

import { resolveTeamColor } from "@/lib/colors";
import type { BoardTheme } from "@/lib/board-theme";

// Broadcast board for Beach / Grass / Light (spec/change-requests/08, matches the
// approved mock). Real top bar pinned to the top, content distributed to fill
// the height (flex column, space-between), so it reads on both 16:9 and 4:3.
// Container-query (cqmin) units, no fixed stage. Competition logo kept (space
// reserved even when absent). Accent drives every box/line. Indoor uses its own
// board.

const SCORE_BLUE = "#1B43E8";

export interface BoardSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  /** 'A' | 'B' | null — who won the set (dimming); null if in progress. */
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

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "3.2cqmin",
        height: "7cqmin",
        flex: "none",
        borderRadius: "0.6cqmin",
        background: color,
        border: "0.35cqmin solid rgba(255,255,255,.85)",
      }}
    />
  );
}

function TeamPlate({ name, color, align }: { name: string; color: string; align: "left" | "right" }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: align === "right" ? "row-reverse" : "row",
        alignItems: "center",
        gap: "2cqmin",
        minWidth: 0,
        padding: "0 1cqmin",
      }}
    >
      <Swatch color={color} />
      <div
        style={{
          fontSize: "5.4cqmin",
          lineHeight: 0.92,
          minWidth: 0,
          textAlign: align === "right" ? "right" : "left",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {name}
      </div>
    </div>
  );
}

function SetsWon({ value }: { value: number }) {
  return (
    <div
      style={{
        width: "9cqmin",
        height: "9cqmin",
        background: "#fff",
        color: SCORE_BLUE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "7cqmin",
        lineHeight: 1,
        borderRadius: "0.5cqmin",
      }}
    >
      {value}
    </div>
  );
}

function Ladder({ sets, accent }: { sets: BoardSet[]; accent: string }) {
  if (sets.length === 0) return <div />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "2cqmin" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6cqmin", fontSize: "5cqmin", textAlign: "right" }}>
        {sets.map((s) => (
          <div key={s.setNumber} style={{ height: "7cqmin", display: "flex", alignItems: "center", justifyContent: "flex-end", opacity: s.winner === "B" ? 0.45 : 1 }}>
            {s.scoreA}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", border: `0.4cqmin solid ${accent}`, borderRadius: "0.5cqmin", overflow: "hidden", fontSize: "4.4cqmin" }}>
        {sets.map((s, i) => (
          <div
            key={s.setNumber}
            style={{
              width: "7cqmin",
              height: "7cqmin",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: i < sets.length - 1 ? `0.4cqmin solid ${accent}` : undefined,
              background: s.winner === null ? accent : undefined,
              color: s.winner === null ? "#fff" : undefined,
            }}
          >
            {s.setNumber}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6cqmin", fontSize: "5cqmin", textAlign: "left" }}>
        {sets.map((s) => (
          <div key={s.setNumber} style={{ height: "7cqmin", display: "flex", alignItems: "center", opacity: s.winner === "A" ? 0.45 : 1 }}>
            {s.scoreB}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BroadcastBoard(props: BoardProps) {
  const t = props.theme;
  const accent = t.accent;
  const sq = <span style={{ width: "3cqmin", height: "3cqmin", background: accent, borderRadius: "0.4cqmin", flex: "none" }} />;
  const big = (v: number) => <div style={{ fontSize: "26cqmin", lineHeight: 0.8, textAlign: "center" }}>{v}</div>;

  return (
    <div
      style={
        {
          position: "fixed",
          inset: 0,
          containerType: "size",
          background: t.bg,
          color: t.font,
          fontFamily: t.ff,
          textTransform: "uppercase",
          fontWeight: 800,
        } as React.CSSProperties
      }
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "3cqmin", height: "100%", gap: "2cqmin" }}>
        {/* Top bar (pinned to the top edge) */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.2cqmin", width: "100%", border: `0.5cqmin solid ${accent}`, borderRadius: "0.8cqmin", padding: "1.2cqmin" }}>
          <TeamPlate name={props.teamAName} color={resolveTeamColor(props.teamAColor, "A")} align="left" />
          <div style={{ display: "flex", gap: "1cqmin", flex: "none" }}>
            <SetsWon value={props.setsWonA} />
            <SetsWon value={props.setsWonB} />
          </div>
          <TeamPlate name={props.teamBName} color={resolveTeamColor(props.teamBColor, "B")} align="right" />
        </div>

        {/* Competition logo — space reserved even when absent */}
        <div style={{ height: "12cqmin", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {props.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.logoUrl} alt="" style={{ height: "10cqmin", maxWidth: "60cqmin", objectFit: "contain" }} />
          ) : null}
        </div>

        {/* Set indicator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2.5cqmin" }}>
          {sq}
          <div style={{ fontSize: "5.5cqmin", letterSpacing: "0.4cqmin" }}>
            {props.finished ? "Final" : props.setNumber ? `Set ${props.setNumber}` : "—"}
          </div>
          {sq}
        </div>

        {/* Big score + ladder */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "3cqmin", width: "100%" }}>
          {big(props.scoreA)}
          <Ladder sets={props.sets} accent={accent} />
          {big(props.scoreB)}
        </div>
      </div>
    </div>
  );
}
