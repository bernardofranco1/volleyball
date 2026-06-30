"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Read-only scoring log the scorer can open to consult the full chronological
// record (points, subs, time-outs, TTO, set start/end, notes, sanctions…) in
// case of a dispute. Opens as a centered, internally-scrollable overlay
// (portaled to <body>) — scrolling here is fine since it's a consultation view,
// and it never disturbs the fixed scoring UI behind it.

interface LogEvent {
  sequence: number;
  eventType: string;
  setNumber: number | null;
  scoreAfterA: number | null;
  scoreAfterB: number | null;
  serverTeam: "A" | "B" | null;
  timestamp: string;
  actor: string;
  notes: string | null;
  payload: Record<string, unknown> | null;
}

type Tone = "point" | "note" | "sanction" | "info";

// Phase markers / internal transitions that aren't meaningful log lines.
const NOISE = new Set([
  "LINEUP_PENDING",
  "TIMEOUT_ACTIVE",
  "TTO_ACTIVE",
  "MEDICAL_TIMEOUT_ACTIVE",
  "VCS_ACTIVE",
  "SET_BREAK",
  "MATCH_CREATED",
  "TIMEOUT_END",
  "TTO_END",
  "MEDICAL_TIMEOUT_END",
]);

const humanize = (t: string) =>
  t.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function ScoringLog({
  matchId,
  teamAName,
  teamBName,
  rosterById,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  rosterById?: Map<string, { jerseyNumber: number | null; fullName: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [evs, setEvs] = useState<LogEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/events`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { events?: LogEvent[] };
      setEvs(data.events ?? []);
    } catch {
      setErr("Couldn't load the log.");
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  const openLog = () => {
    setOpen(true);
    void load();
  };

  // Jump to the most recent entry whenever the list (re)loads.
  useEffect(() => {
    if (open && evs && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [open, evs]);

  const playerName = (id: unknown) => {
    if (typeof id !== "string") return "—";
    const p = rosterById?.get(id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };
  const tn = (t: unknown) =>
    t === "A" ? teamAName : t === "B" ? teamBName : "";
  const teamOf = (e: LogEvent): "A" | "B" | null => {
    const pt = (e.payload as { team?: unknown } | null)?.team;
    if (pt === "A" || pt === "B") return pt;
    if (e.eventType.endsWith("_A")) return "A";
    if (e.eventType.endsWith("_B")) return "B";
    return e.serverTeam ?? null;
  };

  const describe = (e: LogEvent): { text: string; tone: Tone } => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const team = teamOf(e);
    switch (e.eventType) {
      case "RALLY_WON_A":
        return { text: `Point — ${teamAName}`, tone: "point" };
      case "RALLY_WON_B":
        return { text: `Point — ${teamBName}`, tone: "point" };
      case "SUBSTITUTION":
        return {
          text: `Sub — ${tn(team)}: ${playerName(p.inPlayerId)} in, ${playerName(p.outPlayerId)} out`,
          tone: "info",
        };
      case "LIBERO_REPLACEMENT":
        return { text: `Libero ${p.direction === "OUT" ? "out" : "in"} — ${tn(team)}`, tone: "info" };
      case "LIBERO_REDESIGNATION":
        return { text: `Libero re-designated — ${tn(team)}`, tone: "info" };
      case "TIMEOUT_REQUEST":
        return { text: `Time-out — ${tn(team)}`, tone: "info" };
      case "TTO_START":
        return { text: "Technical time-out", tone: "info" };
      case "MEDICAL_TIMEOUT":
        return { text: `Medical time-out — ${tn(team)}`, tone: "info" };
      case "SET_START":
        return { text: `Set ${e.setNumber ?? ""} — start`, tone: "info" };
      case "SET_END":
        return { text: `Set ${e.setNumber ?? ""} — end`, tone: "info" };
      case "MATCH_START":
        return { text: "Match start", tone: "info" };
      case "MATCH_END":
      case "MATCH_OVER":
        return { text: "Match end", tone: "info" };
      case "COIN_TOSS":
        return { text: `Coin toss — ${tn(p.firstServer)} to serve`, tone: "info" };
      case "LINEUP_CONFIRMED":
        return { text: `Lineup confirmed — ${tn(team)}`, tone: "info" };
      case "SIDE_SWITCH":
        return { text: "Switched sides", tone: "info" };
      case "JUMP_SERVE_FOOT_FAULT":
        return { text: `Serve foot fault — ${tn(team)}`, tone: "sanction" };
      case "ATTACK_ARC_FAULT":
        return { text: `Attack arc fault — ${tn(team)}`, tone: "sanction" };
      case "DELAY_WARNING":
        return { text: `Delay warning — ${tn(team)}`, tone: "sanction" };
      case "DELAY_PENALTY":
        return { text: `Delay penalty — ${tn(team)}`, tone: "sanction" };
      case "MISCONDUCT_WARNING":
        return { text: `Misconduct warning — ${tn(team)}`, tone: "sanction" };
      case "MISCONDUCT_PENALTY":
        return { text: `Misconduct penalty — ${tn(team)}`, tone: "sanction" };
      case "MISCONDUCT_EXPULSION":
        return { text: `Expulsion — ${tn(team)}`, tone: "sanction" };
      case "MISCONDUCT_DISQUALIFICATION":
        return { text: `Disqualification — ${tn(team)}`, tone: "sanction" };
      case "VCS_CHALLENGE":
        return { text: `Challenge — ${tn(team)}`, tone: "info" };
      case "VCS_RESULT":
        return { text: "Challenge result", tone: "info" };
      case "NOTE":
        return { text: `Note: ${(p.text as string) ?? e.notes ?? ""}`, tone: "note" };
      case "UNDO":
        return { text: "Undo", tone: "info" };
      default:
        return { text: humanize(e.eventType), tone: "info" };
    }
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const toneClass: Record<Tone, string> = {
    point: "",
    note: "bg-amber-500/10",
    sanction: "bg-red-500/10",
    info: "text-score-dim",
  };

  const visible = (evs ?? []).filter((e) => !NOISE.has(e.eventType));

  return (
    <>
      <button
        type="button"
        onClick={openLog}
        className="rounded border border-border px-2 py-0.5 text-[11px] text-score-dim transition-colors hover:text-foreground"
        title="Open the scoring log"
      >
        Log
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="absolute inset-0 bg-black/60"
              />
              <div className="relative z-10 flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface-raised shadow-2xl">
                <div className="flex flex-none items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <span className="text-sm font-semibold">Scoring log</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="rounded px-2 py-1 text-xs text-score-dim hover:text-foreground"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="rounded px-2 py-1 text-base leading-none text-score-dim hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {loading && !evs ? (
                    <p className="px-2 py-6 text-center text-sm text-score-dim">Loading…</p>
                  ) : err ? (
                    <p className="px-2 py-6 text-center text-sm text-red-400">{err}</p>
                  ) : visible.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-score-dim">No events yet.</p>
                  ) : (
                    <ol className="space-y-0.5">
                      {visible.map((e, i) => {
                        const prev = visible[i - 1];
                        const showSet =
                          e.setNumber != null && (!prev || prev.setNumber !== e.setNumber);
                        const { text, tone } = describe(e);
                        const score =
                          e.scoreAfterA != null && e.scoreAfterB != null
                            ? `${e.scoreAfterA}–${e.scoreAfterB}`
                            : "";
                        return (
                          <li key={e.sequence}>
                            {showSet ? (
                              <div className="mt-2 mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-score-dim first:mt-0">
                                Set {e.setNumber}
                              </div>
                            ) : null}
                            <div className={`flex items-baseline gap-2 rounded px-2 py-1 text-sm ${toneClass[tone]}`}>
                              <span className="w-12 flex-none text-right font-mono text-xs tabular-nums text-score-dim">
                                {score}
                              </span>
                              <span className="min-w-0 flex-1 break-words">{text}</span>
                              <span className="flex-none font-mono text-[10px] tabular-nums text-score-dim">
                                {fmtTime(e.timestamp)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
