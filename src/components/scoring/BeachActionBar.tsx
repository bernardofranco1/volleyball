"use client";

import { useEffect, useState } from "react";
import { useMatch } from "@/lib/match-context";
import { resolveTeamColor, readableTextOn } from "@/lib/colors";
import {
  type TeamId,
  activeSet,
  oppositeSide,
  oppositeTeam,
} from "@/engine/beach/types";

type Armed = "A" | "B" | "UNDO" | null;
const ARM_MS = 3000;

export function BeachActionBar({
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
}: {
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
}) {
  const { state, config, dispatch, pending } = useMatch();
  const [armed, setArmed] = useState<Armed>(null);

  // Auto-disarm a two-tap button after a few seconds.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const set = activeSet(state);
  const name = (t: TeamId) => (t === "A" ? teamAName : teamBName);

  // ── terminal / interstitial phases ────────────────────────────────────────
  if (state.status === "FINISHED") {
    return (
      <Banner>
        🏆 {name(state.winner ?? "A")} wins {state.setsWonA}–{state.setsWonB}
      </Banner>
    );
  }

  if (state.rallyPhase === "SET_BREAK") {
    const startNextSet = () => {
      const prev = activeSet(state);
      if (!prev) return;
      dispatch({
        type: "SET_START",
        setNumber: state.currentSetNumber + 1,
        firstServer: oppositeTeam(prev.firstServer),
        teamAStartSide: oppositeSide(prev.teamAStartSide),
      });
    };
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span>
            Set {set?.setNumber} ended — {state.setsWonA}–{state.setsWonB}
          </span>
          <PrimaryButton onClick={startNextSet} disabled={pending}>
            Start next set
          </PrimaryButton>
        </div>
      </Banner>
    );
  }

  if (state.rallyPhase === "TIMEOUT_ACTIVE") {
    return (
      <Banner>
        <PrimaryButton
          onClick={() =>
            dispatch({ type: "TIMEOUT_END", team: state.activeTimeoutTeam ?? "A" })
          }
        >
          End time-out ({name(state.activeTimeoutTeam ?? "A")})
        </PrimaryButton>
      </Banner>
    );
  }

  if (state.rallyPhase === "TTO_ACTIVE") {
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "TTO_END" })}>
          End technical time-out
        </PrimaryButton>
      </Banner>
    );
  }

  if (state.rallyPhase === "MEDICAL_TIMEOUT_ACTIVE") {
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "MEDICAL_TIMEOUT_END" })}>
          End medical time-out
        </PrimaryButton>
      </Banner>
    );
  }

  // ── pre-match setup ───────────────────────────────────────────────────────
  if (state.status === "SETUP") {
    return (
      <Banner>
        <PrimaryButton
          onClick={() =>
            dispatch({ type: "MATCH_CREATED", matchId: state.matchId })
          }
        >
          Set up match
        </PrimaryButton>
      </Banner>
    );
  }

  if (state.status === "COIN_TOSS") {
    return (
      <Banner>
        <div className="flex flex-col items-center gap-3">
          <span className="text-sm text-score-dim">Coin toss — who serves first?</span>
          <div className="flex gap-3">
            <PrimaryButton
              onClick={() =>
                dispatch({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" })
              }
            >
              {teamAName} serves
            </PrimaryButton>
            <PrimaryButton
              onClick={() =>
                dispatch({ type: "COIN_TOSS", firstServer: "B", teamAStartSide: "LEFT" })
              }
            >
              {teamBName} serves
            </PrimaryButton>
          </div>
        </div>
      </Banner>
    );
  }

  if (state.status === "READY") {
    return (
      <Banner>
        <PrimaryButton onClick={() => dispatch({ type: "MATCH_START" })}>
          Start match
        </PrimaryButton>
      </Banner>
    );
  }

  // status LIVE but no active set yet → start the set
  if (!set || set.winner) {
    return (
      <Banner>
        <PrimaryButton
          onClick={() =>
            dispatch({
              type: "SET_START",
              setNumber: state.currentSetNumber,
              firstServer: state.set1FirstServer ?? "A",
              teamAStartSide: "LEFT",
            })
          }
        >
          Start set {state.currentSetNumber}
        </PrimaryButton>
      </Banner>
    );
  }

  // ── live scoring (BETWEEN_RALLIES / RALLY_LIVE) ───────────────────────────
  const tap = (team: TeamId) => {
    if (armed === team) {
      dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" });
      setArmed(null);
    } else {
      setArmed(team);
    }
  };
  const tapUndo = () => {
    if (armed === "UNDO") {
      dispatch({ type: "UNDO", targetEventId: "" });
      setArmed(null);
    } else {
      setArmed("UNDO");
    }
  };

  const timeoutFull = (t: TeamId) =>
    (t === "A" ? set.timeoutsUsedA : set.timeoutsUsedB) >= config.timeoutsPerSet;

  return (
    <div className="flex flex-col gap-3">
      {/* Buttons follow court side so they track switches (brief §4.1). */}
      <div className="grid grid-cols-2 gap-3">
        {(set?.teamASide === "RIGHT"
          ? (["B", "A"] as const)
          : (["A", "B"] as const)
        ).map((t) => (
          <ScoreButton
            key={t}
            armed={armed === t}
            color={resolveTeamColor(t === "A" ? teamAColor : teamBColor, t)}
            onClick={() => tap(t)}
          >
            {armed === t
              ? `Confirm point — ${t === "A" ? teamAName : teamBName}`
              : `Point ${t === "A" ? teamAName : teamBName}`}
          </ScoreButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <SecondaryButton
          disabled={timeoutFull("A")}
          onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: "A" })}
        >
          T/O {teamAName} ({config.timeoutsPerSet - set.timeoutsUsedA})
        </SecondaryButton>
        <SecondaryButton
          armed={armed === "UNDO"}
          onClick={tapUndo}
          disabled={pending}
        >
          {armed === "UNDO" ? "Confirm undo" : "Undo"}
        </SecondaryButton>
        <SecondaryButton
          onClick={() => {
            const text = window.prompt("Note");
            if (text) dispatch({ type: "NOTE", text });
          }}
        >
          Note
        </SecondaryButton>
        <SecondaryButton
          disabled={timeoutFull("B")}
          onClick={() => dispatch({ type: "TIMEOUT_REQUEST", team: "B" })}
        >
          T/O {teamBName} ({config.timeoutsPerSet - set.timeoutsUsedB})
        </SecondaryButton>
      </div>
    </div>
  );
}

// ── presentational atoms ──────────────────────────────────────────────────────

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-24 place-items-center rounded-xl border border-border bg-surface-raised p-4 text-center text-lg font-medium">
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ScoreButton({
  children,
  onClick,
  armed,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  armed: boolean;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: color, color: readableTextOn(color) }}
      className={`rounded-xl px-4 py-4 text-base font-semibold transition-all ${
        armed
          ? "animate-pulse ring-4 ring-white/80"
          : "ring-1 ring-black/10 hover:brightness-110"
      }`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  armed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  armed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
        armed
          ? "border-red-500 bg-red-500/10 text-red-300"
          : "border-border text-score-dim hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
