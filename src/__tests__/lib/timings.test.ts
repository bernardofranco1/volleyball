import { describe, expect, it } from "vitest";
import type { MatchReportData, ReportEvent } from "@/lib/match-report";
import { computeMatchTimings } from "@/lib/timings";

// Timing breakdown (spec/22): per rally (precise via RALLY_START vs
// approximated), per set, per break — timeouts, TTOs, medical, video
// challenges, set breaks — all derivable from the surviving event log.

const T0 = new Date("2026-07-28T10:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

/** Event factory with its own sequence counter — no shared mutable state. */
function eventFactory() {
  let seq = 0;
  return function ev(
    eventType: string,
    payload: Record<string, unknown>,
    score: [number, number] | null,
    sec: number,
  ): ReportEvent {
    seq += 1;
    return {
      id: `evt_${seq}`,
      sequence: seq,
      eventType,
      setNumber: 1,
      scoreAfterA: score?.[0] ?? null,
      scoreAfterB: score?.[1] ?? null,
      timestamp: at(sec),
      actor: "SCORER",
      notes: null,
      payload: { type: eventType, ...payload },
    };
  };
}

function report(events: ReportEvent[]): MatchReportData {
  return {
    matchId: "m1",
    discipline: "BEACH",
    competitionName: "Cup",
    tenantName: "Tenant",
    teamAName: "A",
    teamBName: "B",
    teamACountry: null,
    teamBCountry: null,
    roundName: null,
    matchNumber: 1,
    visId: null,
    phaseName: null,
    venue: null,
    city: null,
    country: null,
    hall: null,
    category: null,
    gender: null,
    courtNumber: null,
    scheduledAt: T0,
    startedAt: T0,
    finishedAt: at(2000),
    status: "FINISHED",
    setsWonA: 1,
    setsWonB: 0,
    winner: "A",
    sets: [],
    events,
    approval: { confirmedVia: null, confirmedAt: null, officials: [], signatures: [] },
    coachA: null,
    coachB: null,
    rosterA: [],
    rosterB: [],
  };
}

/** The shared two-set fixture: precise + approximated rallies, every break kind. */
function fixture() {
  const ev = eventFactory();
  return computeMatchTimings(
    report([
      ev("SET_START", { setNumber: 1, firstServer: "A" }, [0, 0], 0),
      // Precise rally: RALLY_START at 10s, point at 22s → 12s duration.
      ev("RALLY_START", {}, null, 10),
      ev("RALLY_WON_A", {}, [1, 0], 22),
      // Approximated rally: no RALLY_START → start = previous event (22s).
      ev("RALLY_WON_B", {}, [1, 1], 40),
      // Timeout 45s..75s (30s).
      ev("TIMEOUT_REQUEST", { team: "B" }, [1, 1], 45),
      ev("TIMEOUT_END", { team: "B" }, [1, 1], 75),
      // TTO 100..160 (60s).
      ev("TTO_START", {}, [2, 1], 100),
      ev("TTO_END", {}, [2, 1], 160),
      // Medical 200..350 (150s).
      ev("MEDICAL_TIMEOUT", { team: "A" }, [2, 1], 200),
      ev("MEDICAL_TIMEOUT_END", {}, [2, 1], 350),
      // Challenge 400..425 (25s).
      ev("VCS_CHALLENGE", { team: "B" }, [2, 1], 400),
      ev("VCS_RESULT", { upheld: false, team: "B" }, [2, 1], 425),
      ev("SET_END", { setNumber: 1, winner: "A", scoreA: 21, scoreB: 10 }, [21, 10], 900),
      // Set break 900..960 (60s), then set 2.
      ev("SET_START", { setNumber: 2, firstServer: "B" }, [0, 0], 960),
      ev("RALLY_WON_A", {}, [1, 0], 980),
      ev("SET_END", { setNumber: 2, winner: "A", scoreA: 21, scoreB: 5 }, [21, 5], 1900),
    ]),
  );
}

describe("computeMatchTimings", () => {
  it("times rallies — precise via RALLY_START, approximated from the previous event", () => {
    const t = fixture();
    expect(t.rallies).toHaveLength(3);
    expect(t.rallies[0]).toMatchObject({
      setNumber: 1,
      winner: "A",
      durationMs: 12_000,
      precise: true,
    });
    expect(t.rallies[1]).toMatchObject({
      winner: "B",
      durationMs: 18_000,
      precise: false,
    });
  });

  it("times sets and counts their (precise) rallies", () => {
    const t = fixture();
    expect(t.sets[0]).toMatchObject({
      setNumber: 1,
      durationMs: 900_000,
      rallies: 2,
      preciseRallies: 1,
    });
    expect(t.sets[1]).toMatchObject({ setNumber: 2, durationMs: 940_000 });
  });

  it("classifies every break kind with its duration and team", () => {
    const t = fixture();
    // TO 30s, TTO 60s, medical 150s, challenge 25s, set break 60s.
    const byKind = Object.fromEntries(t.breaks.map((b) => [b.kind, b]));
    expect(byKind.TIMEOUT).toMatchObject({ team: "B", durationMs: 30_000 });
    expect(byKind.TECHNICAL_TIMEOUT).toMatchObject({ durationMs: 60_000 });
    expect(byKind.MEDICAL_TIMEOUT).toMatchObject({ team: "A", durationMs: 150_000 });
    expect(byKind.VIDEO_CHALLENGE).toMatchObject({ team: "B", durationMs: 25_000 });
    expect(byKind.SET_BREAK).toMatchObject({ durationMs: 60_000 });
  });

  it("totals the match and the challenge time", () => {
    const t = fixture();
    expect(t.videoChallengeMs).toBe(25_000);
    expect(t.totalMs).toBe(2_000_000);
  });
});
