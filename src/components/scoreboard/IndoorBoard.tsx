"use client";

import { useRef } from "react";
import { resolveTeamColor } from "@/lib/colors";
import type { BoardTheme } from "@/lib/board-theme";
import type { BoardSet } from "@/components/scoreboard/BroadcastBoard";
import { useFitText } from "@/components/scoreboard/useFitText";

// Indoor-exclusive board — court formation (spec/change-requests/08, matches the
// approved mock). Positions 1–6 as jerseys on a 2:1 court (net in the middle,
// dashed 3 m lines), libero outlined in team colour, serving player carries a
// ball badge; per-team timeout/sub stacks flank the court; set ladder below.
// Falls back to a side list when there's no rotation. No logo (court gets the
// space). Everything recolours with the accent; container-query (cqmin) units.

const SCORE_BLUE = "#1B43E8";
const ROMAN = ["I", "II", "III", "IV", "V"];

export interface IndoorPlayer {
  pos: number; // 1..6
  jersey: string | number | null;
  name: string;
  serving: boolean;
  libero: boolean;
  /** Stable player identity — keys the jersey so it slides on rotation. */
  key?: string;
}

export interface IndoorRosterEntry {
  jersey: string | number | null;
  name: string;
  libero: boolean;
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
  rosterA: IndoorRosterEntry[];
  rosterB: IndoorRosterEntry[];
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  timeoutsPerSet: number;
  subsUsedA: number;
  subsUsedB: number;
  maxSubsPerSet: number;
  theme: BoardTheme;
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ink(hex: string): string {
  return lum(hex) > 0.55 ? "#10233b" : "#ffffff";
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

function Jersey({ p, teamColor, accent }: { p: IndoorPlayer; teamColor: string; accent: string }) {
  const lib = p.libero;
  const fill = lib ? "none" : teamColor;
  const stroke = lib ? teamColor : "rgba(255,255,255,.35)";
  const numCol = lib ? teamColor : ink(teamColor);
  const serving = p.serving;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5cqmin", width: "15cqmin" }}>
      <div style={{ position: "relative", width: "7.5cqmin", height: "7cqmin" }}>
        {serving ? (
          <span
            style={{
              position: "absolute",
              top: "-0.8cqmin",
              right: "-0.8cqmin",
              width: "2.8cqmin",
              height: "2.8cqmin",
              borderRadius: "50%",
              background: accent,
              border: "0.3cqmin solid #fff",
              zIndex: 1,
            }}
          />
        ) : null}
        <svg viewBox="0 0 64 60" width="100%" height="100%" style={{ display: "block" }}>
          <path
            d="M21 4 L26 9 Q32 12 38 9 L43 4 L60 14 L53 25 L47 21.5 L47 56 L17 56 L17 21.5 L11 25 L4 14 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={lib ? 3 : 1.5}
          />
          <text x="32" y="42" textAnchor="middle" fontFamily="'Arial Narrow',sans-serif" fontWeight="800" fontSize="26" fill={numCol}>
            {p.jersey ?? "–"}
          </text>
        </svg>
      </div>
      <div style={{ width: "100%", overflow: "hidden", display: "flex", justifyContent: "center" }}>
        <span className="fit" data-max="3.6" style={{ whiteSpace: "nowrap", fontWeight: 800, lineHeight: 1, fontSize: "3.6cqmin" }}>
          {p.name}
        </span>
      </div>
      {lib ? (
        <div style={{ fontSize: "1.7cqmin", letterSpacing: "0.1cqmin", color: teamColor, fontFamily: "system-ui,sans-serif" }}>
          LIBERO
        </div>
      ) : null}
    </div>
  );
}

// Vertical (top→bottom) zone order per half. The right half mirrors the left so
// the two servers sit diagonally opposite (bottom-left vs top-right) — matching
// the scorer's PositionalCourt.
const BACK_ZONES = [5, 6, 1];
const FRONT_ZONES = [4, 3, 2];

/** Target (x%, y%) of a rotation position within the whole court box. */
function courtCoord(side: "a" | "b", pos: number): { x: number; y: number } {
  const isBack = BACK_ZONES.includes(pos);
  const backOrder = side === "a" ? BACK_ZONES : [...BACK_ZONES].reverse();
  const frontOrder = side === "a" ? FRONT_ZONES : [...FRONT_ZONES].reverse();
  const row = (isBack ? backOrder : frontOrder).indexOf(pos);
  const y = ((row + 0.5) / 3) * 100;
  // Columns: back is the outer column, front is nearest the net (centre).
  const backX = side === "a" ? 13 : 87;
  const frontX = side === "a" ? 37 : 63;
  return { x: isBack ? backX : frontX, y };
}

/** Absolutely-positioned jerseys for one half, keyed by player so they slide. */
function HalfLayer({ rotation, side, teamColor, accent }: { rotation: IndoorPlayer[]; side: "a" | "b"; teamColor: string; accent: string }) {
  return (
    <>
      {rotation.map((p, i) => {
        const { x, y } = courtCoord(side, p.pos);
        return (
          <div
            key={p.key ?? `${side}-${i}`}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
              transition: "left 550ms cubic-bezier(0.4,0,0.2,1), top 550ms cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <Jersey p={p} teamColor={teamColor} accent={accent} />
          </div>
        );
      })}
    </>
  );
}

function StatUnit({ label, val, accent }: { label: string; val: string; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4cqmin" }}>
      <span style={{ fontSize: "1.6cqmin", opacity: 0.7, fontFamily: "system-ui,sans-serif", textTransform: "none" }}>{label}</span>
      <span
        style={{
          minWidth: "7cqmin",
          height: "5.2cqmin",
          border: `0.32cqmin solid ${accent}`,
          borderRadius: "0.5cqmin",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "3cqmin",
        }}
      >
        {val}
      </span>
    </div>
  );
}

function TeamStatsV(props: { to: string; sub: string; accent: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2.4cqmin", alignItems: "center", flex: "none" }}>
      <StatUnit label="Time-outs" val={props.to} accent={props.accent} />
      <StatUnit label="Subs" val={props.sub} accent={props.accent} />
    </div>
  );
}

function LadderH({ sets, accent }: { sets: BoardSet[]; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1cqmin" }}>
      {sets.map((s) => {
        const live = s.winner === null;
        return (
          <div
            key={s.setNumber}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              border: `0.3cqmin solid ${accent}`,
              borderRadius: "0.5cqmin",
              background: live ? accent : undefined,
              padding: "0.3cqmin 0.8cqmin",
              minWidth: "5.5cqmin",
            }}
          >
            <div style={{ fontSize: "1.6cqmin", opacity: 0.8 }}>{ROMAN[s.setNumber - 1] ?? s.setNumber}</div>
            <div style={{ fontSize: "2.6cqmin", lineHeight: 1.1 }}>
              <span style={{ color: live ? "#fff" : s.winner === "A" ? accent : "inherit", opacity: s.winner === "B" ? 0.5 : 1 }}>{s.scoreA}</span>
              <span style={{ opacity: 0.4 }}> · </span>
              <span style={{ color: live ? "#fff" : s.winner === "B" ? accent : "inherit", opacity: s.winner === "A" ? 0.5 : 1 }}>{s.scoreB}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListRow({ p, align, accent }: { p: IndoorRosterEntry; align: "left" | "right"; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: align === "right" ? "row-reverse" : "row",
        alignItems: "center",
        gap: "1.1cqmin",
        border: `0.28cqmin solid ${accent}`,
        borderRadius: "0.5cqmin",
        padding: "0.6cqmin 1cqmin",
        height: "5.6cqmin",
      }}
    >
      <span
        style={{
          fontSize: "3cqmin",
          width: "5cqmin",
          textAlign: "center",
          flex: "none",
          color: p.libero ? accent : SCORE_BLUE,
          background: p.libero ? "transparent" : "#fff",
          border: `0.22cqmin solid ${accent}`,
          borderRadius: "0.4cqmin",
          lineHeight: 1.5,
        }}
      >
        {p.jersey ?? "–"}
      </span>
      <span
        className="fit"
        data-max="3"
        style={{
          fontSize: "2.9cqmin",
          fontWeight: 600,
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
          textAlign: align === "right" ? "right" : "left",
        }}
      >
        {p.name}
      </span>
    </div>
  );
}

export function IndoorBoard(props: IndoorBoardProps) {
  const t = props.theme;
  const accent = t.accent;
  const tcA = resolveTeamColor(props.teamAColor, "A");
  const tcB = resolveTeamColor(props.teamBColor, "B");
  const rootRef = useRef<HTMLDivElement>(null);
  const hasCourt = props.rotationA.length > 0 && props.rotationB.length > 0;
  useFitText(rootRef, [
    props.rotationA,
    props.rotationB,
    props.rosterA,
    props.rosterB,
    props.teamAName,
    props.teamBName,
    hasCourt,
  ]);

  const scorePlate = (v: number) => (
    <div
      style={{
        minWidth: "10cqmin",
        height: "12cqmin",
        background: "#fff",
        color: SCORE_BLUE,
        border: `0.4cqmin solid ${accent}`,
        borderRadius: "0.6cqmin",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "10cqmin",
        lineHeight: 1,
      }}
    >
      {v}
    </div>
  );
  const setsWonPlate = (v: number) => (
    <div
      style={{
        minWidth: "4.6cqmin",
        height: "5.4cqmin",
        background: "#fff",
        color: SCORE_BLUE,
        borderRadius: "0.5cqmin",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "4.2cqmin",
        lineHeight: 1,
      }}
    >
      {v}
    </div>
  );

  const teamHdr = (name: string, color: string, align: "left" | "right") => (
    <div style={{ display: "flex", flexDirection: align === "right" ? "row-reverse" : "row", alignItems: "center", gap: "1.8cqmin", minWidth: 0, flex: 1 }}>
      <Swatch color={color} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden", justifyContent: "center" }}>
        <span className="fit" data-max="9" style={{ whiteSpace: "nowrap", lineHeight: 0.95, fontSize: "9cqmin", textAlign: "center" }}>
          {name}
        </span>
      </div>
    </div>
  );

  const center = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2cqmin", flex: "none" }}>
      <div style={{ fontSize: "3.2cqmin", letterSpacing: "0.3cqmin", color: accent }}>
        {props.finished ? "Final" : props.setNumber ? `Set ${props.setNumber}` : "—"}
      </div>
      <div style={{ display: "flex", gap: "1.2cqmin" }}>
        {scorePlate(props.scoreA)}
        {scorePlate(props.scoreB)}
      </div>
      <div style={{ display: "flex", gap: "1.2cqmin" }}>
        {setsWonPlate(props.setsWonA)}
        {setsWonPlate(props.setsWonB)}
      </div>
    </div>
  );

  const courtBody = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, justifyContent: "center", gap: "2cqmin" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "3cqmin" }}>
        <TeamStatsV to={`${props.timeoutsUsedA}/${props.timeoutsPerSet}`} sub={`${props.subsUsedA}/${props.maxSubsPerSet}`} accent={accent} />
        <div style={{ position: "relative", height: "56cqmin", aspectRatio: "2/1", border: "0.4cqmin solid rgba(255,255,255,.55)", borderRadius: "0.6cqmin", flex: "none" }}>
          {/* Centre net */}
          <div style={{ position: "absolute", left: "50%", top: "3%", bottom: "3%", width: "0.6cqmin", background: "#fff", transform: "translateX(-50%)" }} />
          <HalfLayer rotation={props.rotationA} side="a" teamColor={tcA} accent={accent} />
          <HalfLayer rotation={props.rotationB} side="b" teamColor={tcB} accent={accent} />
        </div>
        <TeamStatsV to={`${props.timeoutsUsedB}/${props.timeoutsPerSet}`} sub={`${props.subsUsedB}/${props.maxSubsPerSet}`} accent={accent} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <LadderH sets={props.sets} accent={accent} />
      </div>
    </div>
  );

  const listBody = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "3cqmin", width: "100%", flex: 1, alignItems: "start", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7cqmin" }}>
        {props.rosterA.map((p, i) => (
          <ListRow key={i} p={p} align="left" accent={accent} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.4cqmin" }}>
        <LadderH sets={props.sets} accent={accent} />
        <div style={{ display: "flex", alignItems: "center", gap: "1.4cqmin" }}>
          <TeamStatsV to={`${props.timeoutsUsedA}/${props.timeoutsPerSet}`} sub={`${props.subsUsedA}/${props.maxSubsPerSet}`} accent={accent} />
          <TeamStatsV to={`${props.timeoutsUsedB}/${props.timeoutsPerSet}`} sub={`${props.subsUsedB}/${props.maxSubsPerSet}`} accent={accent} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7cqmin" }}>
        {props.rosterB.map((p, i) => (
          <ListRow key={i} p={p} align="right" accent={accent} />
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
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
          "--bg": t.bg,
          "--accent": t.accent,
        } as React.CSSProperties
      }
    >
      <div style={{ display: "flex", flexDirection: "column", padding: "2.6cqmin", gap: "1.6cqmin", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "2cqmin", width: "100%", flex: "none" }}>
          {teamHdr(props.teamAName, tcA, "left")}
          {center}
          {teamHdr(props.teamBName, tcB, "right")}
        </div>
        {hasCourt ? courtBody : listBody}
      </div>
    </div>
  );
}
