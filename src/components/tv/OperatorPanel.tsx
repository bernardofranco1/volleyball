"use client";

/**
 * The operator's controls (spec/47).
 *
 * Invisible until the pointer moves, because a vision mixer's browser source has
 * no pointer and must never see it. Everything here has a hotkey too — during a
 * match the operator's hands are on the keyboard and the mouse is on the mixer.
 *
 * The panel is also the only place the LIVE board is shown. Everywhere else the
 * delayed frame is what matters; here the operator needs to see both, because
 * the gap between them is exactly what they are dialling in.
 */

import type { VisBoardData } from "@/lib/vis-live/board-data";
import { DELAY_STEP_S, MAX_DELAY_S } from "@/lib/tv/delay";
import {
  CHALLENGE_CATEGORIES,
  type ChallengeCategory,
  type Graphics,
  type OperatorState,
} from "@/lib/tv/director";
import type { PlayerState } from "@/components/tv/StreamPlayer";

export function OperatorPanel({
  open,
  delay,
  onDelay,
  operator,
  onOperator,
  graphics,
  board,
  live,
  staleFor,
  buffered,
  playerState,
  boardId,
}: {
  open: boolean;
  delay: number;
  onDelay: (d: number) => void;
  operator: OperatorState;
  onOperator: (f: (o: OperatorState) => OperatorState) => void;
  graphics: Graphics;
  /** The delayed frame — what is on screen. */
  board: VisBoardData;
  /** The newest frame — what the hall is at. */
  live: VisBoardData;
  staleFor: number | null;
  buffered: number;
  playerState: PlayerState;
  boardId: string;
}) {
  const onAir = [
    graphics.bug && "bug",
    graphics.challenge && `challenge:${graphics.challenge.status}`,
    graphics.substitution && "sub",
    graphics.timeout && "timeout",
    graphics.keyMoment && graphics.keyMoment.text.toLowerCase(),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ ...S.wrap, opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}>
      <div style={S.row}>
        <span style={S.tag}>{boardId}</span>
        <span style={playerState === "playing" ? S.ok : S.warn}>{playerState}</span>
        {staleFor != null ? (
          <span style={S.warn}>feed {staleFor}s stale</span>
        ) : (
          <span style={S.ok}>feed live</span>
        )}
        <span style={S.dim}>{buffered} frames</span>
        <span style={S.spacer} />
        <span style={S.dim}>on air:</span>
        <span style={S.tag}>{onAir || "nothing"}</span>
      </div>

      <div style={S.row}>
        <label style={S.k} htmlFor="op-delay">
          delay <kbd style={S.kbd}>[</kbd>
          <kbd style={S.kbd}>]</kbd>
        </label>
        <input
          id="op-delay"
          type="range"
          min={0}
          max={MAX_DELAY_S}
          step={DELAY_STEP_S}
          value={delay}
          onChange={(e) => onDelay(Number(e.target.value))}
          style={{ width: 260 }}
        />
        <span style={S.num}>{delay.toFixed(1)}s</span>
        <span style={S.spacer} />
        {/* Showing both scores is how the delay gets set: nudge until the
            delayed pair lags the live pair by exactly one rally. */}
        <span style={S.dim}>shown</span>
        <span style={S.tag}>
          {board.teamA.code} {board.scoreA}–{board.scoreB} {board.teamB.code}
        </span>
        <span style={S.dim}>live</span>
        <span style={S.tag}>
          {live.teamA.code} {live.scoreA}–{live.scoreB} {live.teamB.code}
        </span>
      </div>

      <div style={S.row}>
        <button
          type="button"
          style={operator.hideAll ? S.btnOn : S.btn}
          onClick={() => onOperator((o) => ({ ...o, hideAll: !o.hideAll }))}
        >
          {operator.hideAll ? "graphics hidden" : "hide graphics"}{" "}
          <kbd style={S.kbd}>H</kbd>
        </button>
        <button
          type="button"
          style={S.btn}
          onClick={() =>
            void document.documentElement.requestFullscreen?.().catch(() => {})
          }
        >
          fullscreen <kbd style={S.kbd}>F</kbd>
        </button>
        <span style={S.spacer} />
        <span style={S.k}>
          challenge <kbd style={S.kbd}>C</kbd>
        </span>
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            style={operator.manualChallenge?.side === side ? S.btnOn : S.btn}
            onClick={() =>
              onOperator((o) => ({
                ...o,
                manualChallenge: { side, status: "REQUESTED" },
              }))
            }
          >
            {side === "A" ? board.teamA.code || "A" : board.teamB.code || "B"}
          </button>
        ))}
        {(
          [
            ["REVIEW", "R"],
            ["SUCCESSFUL", "S"],
            ["UNSUCCESSFUL", "U"],
          ] as const
        ).map(([status, key]) => (
          <button
            key={status}
            type="button"
            disabled={!operator.manualChallenge}
            style={
              operator.manualChallenge?.status === status
                ? S.btnOn
                : operator.manualChallenge
                  ? S.btn
                  : S.btnOff
            }
            onClick={() =>
              onOperator((o) =>
                o.manualChallenge
                  ? { ...o, manualChallenge: { ...o.manualChallenge, status } }
                  : o,
              )
            }
          >
            {status.toLowerCase()} <kbd style={S.kbd}>{key}</kbd>
          </button>
        ))}
        <button
          type="button"
          style={S.btn}
          onClick={() =>
            onOperator((o) => ({ ...o, manualChallenge: null, category: null }))
          }
        >
          clear <kbd style={S.kbd}>esc</kbd>
        </button>
      </div>

      <div style={S.row}>
        <span style={S.k}>category</span>
        {CHALLENGE_CATEGORIES.map((cat, i) => (
          <button
            key={cat}
            type="button"
            style={operator.category === cat ? S.btnOn : S.btn}
            onClick={() =>
              onOperator((o) => ({
                ...o,
                category: o.category === cat ? null : (cat as ChallengeCategory),
              }))
            }
          >
            {cat} <kbd style={S.kbd}>{i + 1}</kbd>
          </button>
        ))}
      </div>

      <p style={S.note}>
        No feed states what a challenge was FOR — VIS publishes only how many were
        requested and how many refused — so the category above is the one thing on
        these graphics that has to be typed by a person.
      </p>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: {
    position: "fixed",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 10,
    background: "rgba(4,7,15,0.94)",
    borderBottom: "1px solid #1f2937",
    padding: "10px 14px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    transition: "opacity 140ms linear",
    font: "400 12px/1.3 system-ui, -apple-system, sans-serif",
    color: "#d1d5db",
  },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  spacer: { flex: 1 },
  k: {
    font: "600 10px/1 system-ui, sans-serif",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#6b7280",
  },
  tag: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 4,
    padding: "3px 7px",
    font: "500 12px/1 ui-monospace, monospace",
    color: "#e5e7eb",
  },
  num: { font: "600 13px/1 ui-monospace, monospace", color: "#e5e7eb", minWidth: 46 },
  dim: { color: "#6b7280" },
  ok: { color: "#34d399" },
  warn: { color: "#fbbf24" },
  btn: {
    background: "#0d1220",
    border: "1px solid #1f2937",
    borderRadius: 5,
    color: "#d1d5db",
    padding: "5px 8px",
    font: "500 11px/1.1 system-ui, sans-serif",
    cursor: "pointer",
  },
  btnOn: {
    background: "#E81C37",
    border: "1px solid #E81C37",
    borderRadius: 5,
    color: "#fff",
    padding: "5px 8px",
    font: "600 11px/1.1 system-ui, sans-serif",
    cursor: "pointer",
  },
  btnOff: {
    background: "#0b0f19",
    border: "1px solid #111827",
    borderRadius: 5,
    color: "#4b5563",
    padding: "5px 8px",
    font: "500 11px/1.1 system-ui, sans-serif",
    cursor: "not-allowed",
  },
  kbd: {
    background: "#1f2937",
    borderRadius: 3,
    padding: "0 4px",
    marginLeft: 4,
    font: "400 10px/1.4 ui-monospace, monospace",
    color: "#9ca3af",
  },
  note: { color: "#4b5563", margin: 0, maxWidth: 900 },
};
