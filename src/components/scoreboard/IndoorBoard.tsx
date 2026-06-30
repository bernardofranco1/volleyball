"use client";

import { useEffect, useState } from "react";
import { teamSwatch } from "@/lib/colors";
import type { BoardTheme } from "@/lib/board-theme";
import type { BoardSet } from "@/components/scoreboard/BroadcastBoard";

// Indoor-exclusive broadcast board (React port of the Indoor template). Shows
// score, set score, substitutions, time-outs, the rotation (positions 1–6),
// the serving player (ball beside the name), team names and the competition
// logo. Fully fluid (vmin sizing) and reflows between landscape (rosters on the
// sides) and portrait (rosters stacked below) so it works from 16:9 to 3:4.

export interface IndoorPlayer {
  pos: number; // 1..6
  jersey: string | number | null;
  name: string;
  serving: boolean;
}

export interface IndoorBoardProps {
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  scoreA: number;
  scoreB: number;
  setsWonA: number;
  setsWonB: number;
  sets: BoardSet[];
  setNumber: number | null;
  finished: boolean;
  rotationA: IndoorPlayer[];
  rotationB: IndoorPlayer[];
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  timeoutsPerSet: number;
  subsUsedA: number;
  subsUsedB: number;
  maxSubsPerSet: number;
  logoUrl: string | null;
  theme: BoardTheme;
}

function useIsPortrait() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight > window.innerWidth);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return portrait;
}

export function IndoorBoard(props: IndoorBoardProps) {
  const t = props.theme;
  const portrait = useIsPortrait();
  const swA = teamSwatch(props.teamAColor, t.bg);
  const swB = teamSwatch(props.teamBColor, t.bg);

  const cssVars = {
    "--bg": t.bg,
    "--line": t.line,
    "--font": t.font,
    "--accent": t.accent,
    "--ff": t.ff,
    "--radius": t.radius,
  } as React.CSSProperties;

  const roster = (players: IndoorPlayer[], align: "left" | "right") => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8vmin", minWidth: 0 }}>
      {players.map((p) => (
        <div
          key={p.pos}
          style={{
            display: "flex",
            flexDirection: align === "right" ? "row-reverse" : "row",
            alignItems: "center",
            gap: "1vmin",
            border: `0.25vmin solid ${p.serving ? "var(--accent)" : "var(--line)"}`,
            background: p.serving ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
            borderRadius: "var(--radius)",
            padding: "0.6vmin 1vmin",
            height: "5.2vmin",
          }}
        >
          <span style={{ fontSize: "1.6vmin", opacity: 0.5, width: "2.4vmin", textAlign: "center", flex: "none" }}>
            {p.pos}
          </span>
          <span
            style={{
              fontSize: "2.6vmin",
              fontWeight: 800,
              width: "4vmin",
              textAlign: "center",
              flex: "none",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {p.jersey ?? "–"}
          </span>
          <span
            style={{
              fontSize: "2.4vmin",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
              minWidth: 0,
              textAlign: align === "right" ? "right" : "left",
            }}
          >
            {p.name}
          </span>
          {/* serving ball */}
          <span
            style={{
              width: "2.4vmin",
              height: "2.4vmin",
              borderRadius: "50%",
              background: "var(--accent)",
              flex: "none",
              visibility: p.serving ? "visible" : "hidden",
            }}
          />
        </div>
      ))}
    </div>
  );

  const teamHeader = (
    name: string,
    sw: { color: string; border: string },
    align: "left" | "right",
  ) => (
    <div
      style={{
        display: "flex",
        flexDirection: align === "right" ? "row-reverse" : "row",
        alignItems: "center",
        gap: "1.4vmin",
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: "1.2vmin",
          height: "5vmin",
          flex: "none",
          borderRadius: "0.4vmin",
          background: sw.color,
          border: `0.2vmin solid ${sw.border}`,
        }}
      />
      <div
        style={{
          fontSize: "4.4vmin",
          fontWeight: 800,
          letterSpacing: "0.5px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {name}
      </div>
    </div>
  );

  const statBox = (left: string, label: string, right: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1.2vmin", width: "100%" }}>
      <Cell>{left}</Cell>
      <div style={{ fontSize: "1.5vmin", letterSpacing: "0.2vmin", opacity: 0.6, fontFamily: "ui-monospace,monospace", textTransform: "none", minWidth: "12vmin", textAlign: "center" }}>
        {label}
      </div>
      <Cell>{right}</Cell>
    </div>
  );

  const center = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.6vmin", minWidth: 0 }}>
      <div style={{ fontSize: "3.4vmin", fontWeight: 800, letterSpacing: "0.3vmin" }}>
        {props.finished ? "Final" : props.setNumber ? `Set ${props.setNumber}` : "—"}
      </div>
      <div style={{ display: "flex", gap: "1.4vmin" }}>
        <BigBox>{props.scoreA}</BigBox>
        <BigBox>{props.scoreB}</BigBox>
      </div>
      {statBox(String(props.setsWonA), "SETS", String(props.setsWonB))}
      <Ladder sets={props.sets} />
      {statBox(`${props.timeoutsUsedA}/${props.timeoutsPerSet}`, "TIME-OUTS", `${props.timeoutsUsedB}/${props.timeoutsPerSet}`)}
      {statBox(`${props.subsUsedA}/${props.maxSubsPerSet}`, "SUBS", `${props.subsUsedB}/${props.maxSubsPerSet}`)}
    </div>
  );

  const logo = props.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.logoUrl} alt="" style={{ maxWidth: "40vmin", maxHeight: "9vmin", objectFit: "contain" }} />
  ) : null;

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
        gap: "2vmin",
        padding: "3vmin",
        overflow: "hidden",
        textTransform: "uppercase",
        ...cssVars,
      }}
    >
      {logo}
      {portrait ? (
        <>
          <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: "2vmin" }}>
            {teamHeader(props.teamAName, swA, "left")}
            {teamHeader(props.teamBName, swB, "right")}
          </div>
          {center}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.4vmin", width: "100%", flex: 1, minHeight: 0 }}>
            {roster(props.rotationA, "left")}
            {roster(props.rotationB, "right")}
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "3vmin", width: "100%", flex: 1, alignItems: "start", minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.4vmin", minWidth: 0 }}>
            {teamHeader(props.teamAName, swA, "left")}
            {roster(props.rotationA, "left")}
          </div>
          {center}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.4vmin", minWidth: 0 }}>
            {teamHeader(props.teamBName, swB, "right")}
            {roster(props.rotationB, "right")}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minWidth: "7vmin",
        height: "6vmin",
        border: "0.3vmin solid var(--line)",
        borderRadius: "var(--radius)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "3.4vmin",
        fontWeight: 800,
        padding: "0 1vmin",
      }}
    >
      {children}
    </div>
  );
}

function BigBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "16vmin",
        height: "15vmin",
        border: "0.6vmin solid var(--accent)",
        borderRadius: "var(--radius)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12vmin",
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {children}
    </div>
  );
}

function Ladder({ sets }: { sets: BoardSet[] }) {
  if (sets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5vmin" }}>
      {sets.map((s) => (
        <div
          key={s.setNumber}
          style={{
            display: "grid",
            gridTemplateColumns: "7vmin 5vmin 7vmin",
            alignItems: "center",
            fontSize: "3vmin",
            fontWeight: 800,
            ...(s.winner === null
              ? { background: "var(--accent)", color: "var(--bg)", borderRadius: "var(--radius)" }
              : {}),
          }}
        >
          <div style={{ textAlign: "right", opacity: s.winner === "B" ? 0.45 : 1 }}>{s.scoreA}</div>
          <div style={{ textAlign: "center", fontSize: "2vmin", opacity: 0.7 }}>
            {s.setNumber}
          </div>
          <div style={{ textAlign: "left", opacity: s.winner === "A" ? 0.45 : 1 }}>{s.scoreB}</div>
        </div>
      ))}
    </div>
  );
}
