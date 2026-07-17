"use client";

import { useLayoutEffect, useRef } from "react";
import { resolveTeamColor } from "@/lib/colors";
import type { BoardTheme } from "@/lib/board-theme";

// Broadcast board for Beach / Grass / Light (spec/change-requests/08 + 09,
// matches the approved mocks). Real top bar pinned to the top, past sets
// stacked under it, "Set N" dead-centre between the two big numbers with the
// serve ball beside it. Container-query (cqmin) units, no fixed stage.
// Score changes roll like an odometer; side-outs fly the ball in a V across
// the board (both skipped under prefers-reduced-motion). Indoor uses its own
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

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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

function PastSets({ sets }: { sets: BoardSet[] }) {
  const done = sets.filter((s) => s.winner !== null);
  if (done.length === 0) return null;
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        flexDirection: "column",
        gap: "0.7cqmin",
        alignItems: "center",
        paddingTop: "0.6cqmin",
      }}
    >
      {done.map((s) => (
        <div
          key={s.setNumber}
          style={{ display: "flex", alignItems: "baseline", gap: "1.6cqmin", fontVariantNumeric: "tabular-nums" }}
        >
          <span style={{ fontSize: "2.9cqmin", letterSpacing: "0.25cqmin", fontWeight: 700, opacity: 0.55 }}>
            Set {s.setNumber}
          </span>
          <span style={{ fontSize: "3.8cqmin", letterSpacing: "0.1cqmin" }}>
            <span style={{ opacity: s.winner === "B" ? 0.45 : 1 }}>{s.scoreA}</span>
            <span style={{ opacity: 0.7 }}>:</span>
            <span style={{ opacity: s.winner === "A" ? 0.45 : 1 }}>{s.scoreB}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Odometer roll on every value change: the new number drops in while the old
// falls away (mirrored when the value decreases, so an undo reads as rolling
// back). Skipped on mount and under reduced motion.
function RollingScore({ value, gridArea }: { value: number; gridArea: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const digitRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    const box = boxRef.current;
    const digit = digitRef.current;
    if (prev === null || prev === value || !box || !digit) return;
    if (prefersReducedMotion()) return;

    digit.getAnimations().forEach((a) => a.cancel());
    box.querySelectorAll("[data-outgoing]").forEach((n) => n.remove());

    const outgoing = document.createElement("span");
    outgoing.setAttribute("data-outgoing", "");
    outgoing.textContent = String(prev);
    outgoing.style.position = "absolute";
    outgoing.style.inset = "0";
    box.appendChild(outgoing);

    const dir = value > prev ? 1 : -1;
    outgoing.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${dir * 115}%)`, opacity: 0 },
      ],
      { duration: 500, easing: "cubic-bezier(.5,0,.7,.4)" }
    ).onfinish = () => outgoing.remove();
    digit.animate(
      [{ transform: `translateY(${dir * -115}%)` }, { transform: "translateY(0)" }],
      { duration: 500, easing: "cubic-bezier(.3,.4,.3,1)" }
    );
  }, [value]);

  return (
    <div
      ref={boxRef}
      style={{
        gridArea,
        fontSize: "26cqmin",
        lineHeight: 0.8,
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <span ref={digitRef} style={{ display: "block" }}>
        {value}
      </span>
    </div>
  );
}

export function BroadcastBoard(props: BoardProps) {
  const t = props.theme;
  const accent = t.accent;

  const boardRef = useRef<HTMLDivElement>(null);
  const logoBarRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLImageElement>(null);
  const prevServingRef = useRef<"A" | "B" | null>(null);
  const mountedRef = useRef(false);
  // Rect from the previous render — the FLIP "from" when the ball switches sides.
  const lastBallRectRef = useRef<DOMRect | null>(null);

  const showBall = props.serving !== null && !props.finished;

  // Ball V-flight on side-out: FLIP from the old side, bounce at bottom-centre
  // just above the logo bar, half a spin per leg.
  useLayoutEffect(() => {
    const prev = prevServingRef.current;
    const wasMounted = mountedRef.current;
    prevServingRef.current = props.serving;
    mountedRef.current = true;

    const ball = ballRef.current;
    const board = boardRef.current;
    const logoBar = logoBarRef.current;
    if (!wasMounted || prev === null || props.serving === null || prev === props.serving) return;
    if (!ball || !board || !logoBar) return;
    const from = lastBallRectRef.current;
    if (!from) return;
    if (prefersReducedMotion()) return;

    ball.getAnimations().forEach((a) => a.cancel());
    const to = ball.getBoundingClientRect();
    const bb = board.getBoundingClientRect();
    const lb = logoBar.getBoundingClientRect();
    const midX = bb.left + bb.width / 2 - to.width / 2;
    const midY = lb.top - to.height * 1.35;
    ball.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) rotate(0deg)`,
          easing: "cubic-bezier(.55,0,.85,.5)", // dive: ease-in
        },
        {
          transform: `translate(${midX - to.left}px, ${midY - to.top}px) rotate(180deg) scale(1.12,.82)`,
          offset: 0.5,
          easing: "cubic-bezier(.15,.5,.4,1)", // bounce → rise
        },
        { transform: "translate(0,0) rotate(360deg)" },
      ],
      { duration: 900 }
    );
  }, [props.serving]);

  // Record the ball's rect after every render (after the flight effect above
  // has consumed the previous one).
  useLayoutEffect(() => {
    lastBallRectRef.current = ballRef.current?.getBoundingClientRect() ?? null;
  });

  return (
    <div
      ref={boardRef}
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
      <div style={{ display: "flex", flexDirection: "column", padding: "3cqmin", height: "100%", gap: "2cqmin" }}>
        {/* Top bar (pinned to the top edge) */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.2cqmin", width: "100%", border: `0.5cqmin solid ${accent}`, borderRadius: "0.8cqmin", padding: "1.2cqmin", flex: "none" }}>
          <TeamPlate name={props.teamAName} color={resolveTeamColor(props.teamAColor, "A")} align="left" />
          <div style={{ display: "flex", gap: "1cqmin", flex: "none" }}>
            <SetsWon value={props.setsWonA} />
            <SetsWon value={props.setsWonB} />
          </div>
          <TeamPlate name={props.teamBName} color={resolveTeamColor(props.teamBColor, "B")} align="right" />
        </div>

        {/* Completed sets, stacked directly under the top bar */}
        <PastSets sets={props.sets} />

        {/* Centre: 3×3 grid — empty 1fr rows keep the points row vertically centred */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gridTemplateRows: "1fr auto 1fr",
            columnGap: "3cqmin",
            alignItems: "center",
          }}
        >
          <RollingScore value={props.scoreA} gridArea="2 / 1" />
          <div
            style={{
              gridArea: "2 / 2",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: "5.5cqmin", letterSpacing: "0.4cqmin" }}>
              {props.finished ? "Final" : props.setNumber ? `Set ${props.setNumber}` : "—"}
            </div>
            {showBall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={ballRef}
                src="/balls/bv550c.webp"
                alt=""
                style={{
                  position: "absolute",
                  top: "50%",
                  marginTop: "-3cqmin", // margin, not transform — the flight animation owns transform
                  width: "6cqmin",
                  height: "6cqmin",
                  borderRadius: "50%",
                  filter: "drop-shadow(0 .3cqmin .6cqmin rgba(0,0,0,.4))",
                  ...(props.serving === "A"
                    ? { right: "calc(100% + 6cqmin)" }
                    : { left: "calc(100% + 6cqmin)" }),
                }}
              />
            ) : null}
          </div>
          <RollingScore value={props.scoreB} gridArea="2 / 3" />
        </div>

        {/* Competition logo — space reserved even when absent (bottom) */}
        <div ref={logoBarRef} style={{ height: "12cqmin", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {props.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.logoUrl} alt="" style={{ height: "10cqmin", maxWidth: "60cqmin", objectFit: "contain" }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
