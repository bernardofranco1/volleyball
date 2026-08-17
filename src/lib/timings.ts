// Match timing breakdown (spec/22): everything time-shaped the event log
// carries, computed once from the surviving events — per rally, per set, per
// break (timeouts, TTOs, medical, video challenges, set breaks) and per match.
// Pure; served by GET /api/matches/[id]/export.timings and reusable by the
// VSR feed and the scoresheets.

import type { MatchReportData, ReportEvent } from "@/lib/match-report";
import { scoredSurvivingEvents } from "@/lib/scoresheet/official-data";

export interface RallyTiming {
  setNumber: number;
  winner: "A" | "B";
  scoreAfter: { a: number; b: number };
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** true = anchored by a RALLY_START tap (service whistle); false = the
   *  start is approximated from the previous event. */
  precise: boolean;
}

export interface BreakTiming {
  kind:
    | "TIMEOUT"
    | "TECHNICAL_TIMEOUT"
    | "MEDICAL_TIMEOUT"
    | "VIDEO_CHALLENGE"
    | "SET_BREAK";
  team: "A" | "B" | null;
  setNumber: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface SetTiming {
  setNumber: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  rallies: number;
  /** Sum of rally durations (only meaningful where rallies are precise). */
  rallyPlayMs: number;
  preciseRallies: number;
}

export interface MatchTimings {
  matchId: string;
  discipline: string;
  startedAt: string | null;
  endedAt: string | null;
  totalMs: number | null;
  sets: SetTiming[];
  rallies: RallyTiming[];
  breaks: BreakTiming[];
  /** Total video-challenge time — the beach sheet's "Total match duration
   *  adjustment for Video challenge" remark. */
  videoChallengeMs: number;
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const ms = (a: string | null, b: string | null): number | null =>
  a && b ? new Date(b).getTime() - new Date(a).getTime() : null;

export function computeMatchTimings(report: MatchReportData): MatchTimings {
  // Counted scores, not the per-row cache (spec/30 Phase B) — a rally's
  // `scoreAfter` in the timings export must agree with the scoresheet built
  // from the same log, including after an F13 fault correction.
  const scored = scoredSurvivingEvents(report.events);
  const sets: SetTiming[] = [];
  const rallies: RallyTiming[] = [];
  const breaks: BreakTiming[] = [];

  let cur: SetTiming | null = null;
  let prevTs: string | null = null;
  let rallyStartTs: { ts: string; precise: boolean } | null = null;
  let open: Partial<Record<BreakTiming["kind"], BreakTiming>> = {};
  let lastSetEnd: string | null = null;
  let videoChallengeMs = 0;

  const closeBreak = (kind: BreakTiming["kind"], endTs: string | null) => {
    const b = open[kind];
    if (!b) return;
    b.endedAt = endTs;
    b.durationMs = ms(b.startedAt, endTs);
    delete open[kind];
  };

  for (const { event: ev, score: evScore } of scored) {
    const p = (ev.payload ?? {}) as Record<string, unknown> & { type?: string };
    const type = p.type ?? ev.eventType;
    const ts = iso(ev.timestamp);
    if (!ts) continue;

    switch (type) {
      case "SET_START": {
        // The gap since the previous SET_END is the set break.
        if (lastSetEnd)
          breaks.push({
            kind: "SET_BREAK",
            team: null,
            setNumber: (typeof p.setNumber === "number" ? p.setNumber : sets.length + 1) - 1,
            startedAt: lastSetEnd,
            endedAt: ts,
            durationMs: ms(lastSetEnd, ts),
          });
        cur = {
          setNumber: typeof p.setNumber === "number" ? p.setNumber : sets.length + 1,
          startedAt: ts,
          endedAt: null,
          durationMs: null,
          rallies: 0,
          rallyPlayMs: 0,
          preciseRallies: 0,
        };
        sets.push(cur);
        prevTs = ts;
        rallyStartTs = null;
        open = {};
        break;
      }
      case "RALLY_START": {
        rallyStartTs = { ts, precise: true };
        break;
      }
      case "RALLY_WON_A":
      case "RALLY_WON_B": {
        if (!cur) break;
        const start = rallyStartTs ?? (prevTs ? { ts: prevTs, precise: false } : null);
        const startTs = start?.ts ?? cur.startedAt ?? ts;
        const duration = ms(startTs, ts) ?? 0;
        rallies.push({
          setNumber: cur.setNumber,
          winner: type === "RALLY_WON_A" ? "A" : "B",
          scoreAfter: { a: evScore.a, b: evScore.b },
          startedAt: startTs,
          endedAt: ts,
          durationMs: duration,
          precise: start?.precise ?? false,
        });
        cur.rallies += 1;
        cur.rallyPlayMs += duration;
        if (start?.precise) cur.preciseRallies += 1;
        rallyStartTs = null;
        prevTs = ts;
        break;
      }
      case "TIMEOUT_REQUEST":
        open.TIMEOUT = {
          kind: "TIMEOUT",
          team: p.team === "B" ? "B" : "A",
          setNumber: cur?.setNumber ?? null,
          startedAt: ts,
          endedAt: null,
          durationMs: null,
        };
        breaks.push(open.TIMEOUT);
        prevTs = ts;
        break;
      case "TIMEOUT_END":
        closeBreak("TIMEOUT", ts);
        prevTs = ts;
        break;
      case "TTO_START":
        open.TECHNICAL_TIMEOUT = {
          kind: "TECHNICAL_TIMEOUT",
          team: null,
          setNumber: cur?.setNumber ?? null,
          startedAt: ts,
          endedAt: null,
          durationMs: null,
        };
        breaks.push(open.TECHNICAL_TIMEOUT);
        prevTs = ts;
        break;
      case "TTO_END":
        closeBreak("TECHNICAL_TIMEOUT", ts);
        prevTs = ts;
        break;
      case "MEDICAL_TIMEOUT":
        open.MEDICAL_TIMEOUT = {
          kind: "MEDICAL_TIMEOUT",
          team: p.team === "B" ? "B" : "A",
          setNumber: cur?.setNumber ?? null,
          startedAt: ts,
          endedAt: null,
          durationMs: null,
        };
        breaks.push(open.MEDICAL_TIMEOUT);
        prevTs = ts;
        break;
      case "MEDICAL_TIMEOUT_END":
        closeBreak("MEDICAL_TIMEOUT", ts);
        prevTs = ts;
        break;
      case "VCS_CHALLENGE":
        open.VIDEO_CHALLENGE = {
          kind: "VIDEO_CHALLENGE",
          team: p.team === "B" ? "B" : "A",
          setNumber: cur?.setNumber ?? null,
          startedAt: ts,
          endedAt: null,
          durationMs: null,
        };
        breaks.push(open.VIDEO_CHALLENGE);
        break;
      case "VCS_RESULT": {
        const b = open.VIDEO_CHALLENGE;
        closeBreak("VIDEO_CHALLENGE", ts);
        if (b?.durationMs) videoChallengeMs += b.durationMs;
        prevTs = ts;
        break;
      }
      case "SET_END": {
        if (cur) {
          cur.endedAt = ts;
          cur.durationMs = ms(cur.startedAt, ts);
          cur = null;
        }
        lastSetEnd = ts;
        rallyStartTs = null;
        break;
      }
      default:
        break;
    }
  }

  const startedAt = iso(report.startedAt);
  const endedAt = iso(report.finishedAt);
  return {
    matchId: report.matchId,
    discipline: report.discipline,
    startedAt,
    endedAt,
    totalMs: ms(startedAt, endedAt),
    sets,
    rallies,
    breaks,
    videoChallengeMs,
  };
}
