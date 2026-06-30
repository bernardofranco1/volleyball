"use client";

import type { ReactNode } from "react";
import { resolveTeamColor } from "@/lib/colors";

// Phone-first scoring frame. The scoring surface is used primarily on phones, so
// it must fit one viewport: a compact score header, a flexible court zone in the
// middle, and the assign-point buttons pinned to the bottom (thumb zone) — no
// scrolling needed to see the court AND the controls at once. Fills the space
// below the tenant header via flex-1 (the layout makes the content area a flex
// column); the court itself is height-capped so the buttons always stay visible.

interface SetLine {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | null;
}

function TeamScore({
  name,
  color,
  score,
  serving,
}: {
  name: string;
  color: string;
  score: number;
  serving: boolean;
}) {
  return (
    <div className="min-w-0 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <span
          className="h-2.5 w-2.5 flex-none rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="truncate text-xs font-semibold sm:text-sm">{name}</span>
      </div>
      <div className="font-mono text-5xl font-bold leading-none tabular-nums sm:text-6xl">
        {score}
      </div>
      <div
        className="mx-auto mt-1 h-1 w-12 rounded-full"
        style={{ backgroundColor: serving ? color : "transparent" }}
        aria-label={serving ? "serving" : undefined}
      />
    </div>
  );
}

export function ScoreStrip({
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  teamAOnLeft,
  setsWonA,
  setsWonB,
  scoreA,
  scoreB,
  serving,
  statusLabel,
  sets,
}: {
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  /** Court side: true when Team A is on the left (set.teamASide === "LEFT"). */
  teamAOnLeft: boolean;
  setsWonA: number;
  setsWonB: number;
  scoreA: number;
  scoreB: number;
  serving: "A" | "B" | null;
  statusLabel: string;
  sets: SetLine[];
}) {
  // Order everything by court side so the score mirrors the court and the
  // assign-point buttons when teams switch ends.
  const teamOf = (id: "A" | "B") =>
    id === "A"
      ? {
          name: teamAName,
          color: resolveTeamColor(teamAColor, "A"),
          score: scoreA,
          setsWon: setsWonA,
          serving: serving === "A",
        }
      : {
          name: teamBName,
          color: resolveTeamColor(teamBColor, "B"),
          score: scoreB,
          setsWon: setsWonB,
          serving: serving === "B",
        };
  const leftId: "A" | "B" = teamAOnLeft ? "A" : "B";
  const rightId: "A" | "B" = teamAOnLeft ? "B" : "A";
  const left = teamOf(leftId);
  const right = teamOf(rightId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <TeamScore name={left.name} color={left.color} score={left.score} serving={left.serving} />
        <div className="px-1 pb-1 text-center">
          <div className="font-mono text-lg font-semibold tabular-nums text-score-dim">
            {left.setsWon}–{right.setsWon}
          </div>
          <div className="text-[10px] uppercase leading-tight tracking-wide text-score-dim">
            {statusLabel}
          </div>
        </div>
        <TeamScore name={right.name} color={right.color} score={right.score} serving={right.serving} />
      </div>
      {sets.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-1">
          {sets.map((s) => {
            const ls = teamAOnLeft ? s.scoreA : s.scoreB;
            const rs = teamAOnLeft ? s.scoreB : s.scoreA;
            return (
              <span
                key={s.setNumber}
                className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-score-dim"
              >
                <span className={s.winner === leftId ? "text-foreground" : undefined}>{ls}</span>
                <span className="opacity-40">-</span>
                <span className={s.winner === rightId ? "text-foreground" : undefined}>{rs}</span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ScoringShell({
  competitionLabel,
  online,
  pending,
  error,
  score,
  main,
  actions,
  overlay,
}: {
  competitionLabel: string;
  online: boolean;
  pending: boolean;
  error: string | null;
  score: ReactNode;
  main: ReactNode;
  actions: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden">
      {/* Score header (fixed) */}
      <header className="flex-none border-b border-border px-3 pb-2 pt-2 sm:px-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-score-dim">
          <span className="truncate">{competitionLabel}</span>
          <span className="flex flex-none items-center gap-2">
            {pending ? <span aria-hidden>⟳</span> : null}
            <span
              className={`inline-block h-2 w-2 rounded-full ${online ? "bg-green-500" : "bg-amber-500"}`}
              title={online ? "Online" : "Offline — changes queued"}
            />
          </span>
        </div>
        {error ? (
          <p role="alert" className="mb-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {score}
      </header>

      {/* Court / lineup zone (flexible, scrolls only if its own content overflows) */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
        <div className="m-auto w-full max-w-xl">{main}</div>
      </main>

      {/* Action bar (pinned to the bottom — thumb zone) */}
      <div
        className="flex-none border-t border-border bg-surface/95 px-3 py-2 backdrop-blur sm:px-4"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {actions}
      </div>

      {overlay}
    </div>
  );
}
