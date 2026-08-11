import { describe, expect, it } from "vitest";
import { resolveConfig } from "@/engine/config";
import type { MatchReportData, ReportEvent } from "@/lib/match-report";
import { buildVsr, strokesToSvg, vsrFilename } from "@/lib/vsr/build";

// VSR builder (spec/22): the generated snapshot must carry the structure of
// the two reference VolleyStation logs — top-level keys, scout event shapes,
// settings templates — rebuilt purely from the event log.

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

function report(discipline: string, events: ReportEvent[]): MatchReportData {
  return {
    matchId: "m1",
    discipline,
    competitionName: "Test Cup",
    tenantName: "Tenant",
    teamAName: "Alpha",
    teamBName: "Beta",
    teamACountry: "SUI",
    teamBCountry: "ITA",
    roundName: "Final",
    matchNumber: 9,
    visId: "12345",
    phaseName: "Main",
    venue: "Hall 1",
    city: "Lausanne",
    country: "Switzerland",
    hall: "Malley",
    category: "SENIOR",
    gender: "MEN",
    courtNumber: 2,
    scheduledAt: T0,
    startedAt: T0,
    finishedAt: at(3600),
    status: "FINISHED",
    setsWonA: 1,
    setsWonB: 0,
    winner: "A",
    sets: [],
    events,
    approval: {
      confirmedVia: null,
      confirmedAt: null,
      officials: [
        { role: "FIRST_REFEREE", name: "Anna Meier", country: "GER", level: "Int.", source: "MANUAL", personId: null },
        { role: "SCORER", name: "Kit Ian Yu", country: "MAC", level: null, source: "MANUAL", personId: null },
      ],
      signatures: [
        {
          id: "s1",
          role: "TEAM_A_CAPTAIN",
          signerName: "Cap A",
          signerPlayerId: "a1",
          strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0, 0.5], [1, 0.5]]] },
          intent: "ACCEPT",
          remarks: null,
          signedAt: T0,
          signedSequence: 9,
          resultDigest: "d",
          capturedBy: null,
        },
      ],
    },
    coachA: null,
    coachB: null,
    rosterA: [
      { id: "a1", fullName: "Ada Alpha", firstName: "Ada", lastName: "Alpha", role: "PLAYER", jerseyNumber: 1, isCaptain: true, isLibero: false },
      { id: "a2", fullName: "Amy Alpha", firstName: "Amy", lastName: "Alpha", role: "PLAYER", jerseyNumber: 2, isCaptain: false, isLibero: false },
      { id: "a7", fullName: "Lia Libero", firstName: "Lia", lastName: "Libero", role: "PLAYER", jerseyNumber: 7, isCaptain: false, isLibero: true },
    ],
    rosterB: [
      { id: "b1", fullName: "Bea Beta", firstName: "Bea", lastName: "Beta", role: "PLAYER", jerseyNumber: 1, isCaptain: true, isLibero: false },
      { id: "b2", fullName: "Bo Beta", firstName: "Bo", lastName: "Beta", role: "PLAYER", jerseyNumber: 2, isCaptain: false, isLibero: false },
    ],
  };
}

describe("VSR builder", () => {
  it("builds a beach snapshot with per-set coin toss, rallies and TTO", () => {
    const ev = eventFactory();
    const evs = [
      ev("MATCH_CREATED", { matchId: "m1" }, null, 0),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT", tossWinner: "B" }, null, 1),
      ev("MATCH_START", {}, null, 2),
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT", tossWinner: "B" }, [0, 0], 10),
      ev("SERVICE_ORDER", { team: "A", firstServerPlayerId: "a2" }, [0, 0], 11),
      ev("RALLY_START", {}, [0, 0], 25),
      ev("RALLY_WON_A", {}, [1, 0], 30),
      ev("RALLY_WON_B", {}, [1, 1], 55),
      ev("TIMEOUT_REQUEST", { team: "B" }, [1, 1], 60),
      ev("TTO_START", {}, [1, 1], 70),
      ev("VCS_CHALLENGE", { team: "B" }, [1, 1], 80),
      ev("VCS_RESULT", { upheld: true, team: "B" }, [1, 1], 95),
      ev("SET_END", { setNumber: 1, winner: "A", scoreA: 21, scoreB: 15 }, [21, 15], 900),
    ];
    const vsr = buildVsr(report("BEACH", evs), resolveConfig("BEACH", {})) as never as {
      version: number;
      court: string;
      visId: string;
      settings: Record<string, unknown>;
      scout: { sets: Record<string, unknown>[]; ended?: string };
      teams: { home: { shortName: string }; away: Record<string, unknown> };
    };

    expect(vsr.version).toBe(6);
    expect(vsr.visId).toBe("12345");
    expect(vsr.court).toBe("2");
    expect(vsr.settings.variation).toBe("beach");
    expect(vsr.settings.technicalTimeouts).toEqual([21]);
    expect(vsr.settings.winningScore).toBe(2);
    expect(vsr.teams.home.shortName).toBe("SUI");

    const set = vsr.scout.sets[0] as {
      coinToss: Record<string, string>;
      startingLineup: { home: (number | null)[] };
      events: Record<string, Record<string, unknown>>[];
      score: { home: number; away: number };
      duration: number;
    };
    // Beach: per-set coin toss with the recorded winner.
    expect(set.coinToss).toEqual({ leftSide: "home", winner: "away", serve: "home" });
    // Service order → jerseys at slots 0 and 4 (reference layout).
    expect(set.startingLineup.home).toEqual([2, null, null, null, 1, null]);
    expect(set.score).toEqual({ home: 21, away: 15 });
    expect(set.duration).toBe(15);

    const kinds = set.events.map((e) => Object.keys(e)[0]);
    expect(kinds).toEqual(["rally", "rally", "timeout", "technicalTimeout", "videoChallenge"]);
    const rally = set.events[0]!.rally!;
    expect(rally.point).toBe("home");
    expect(rally.endTime).toBe(at(30).toISOString());
    // RALLY_START (the service whistle) anchors the real start time.
    expect(rally.startTime).toBe(at(25).toISOString());
    const vc = set.events[4]!.videoChallenge!;
    expect(vc).toMatchObject({ team: "away", method: "video", response: "correct" });
    expect(vsr.scout.ended).toBe(at(3600).toISOString());
  });

  it("builds an indoor snapshot with match coin toss, lineups, subs and libero", () => {
    const ev = eventFactory();
    const evs = [
      ev("COIN_TOSS", { firstServer: "B", teamAStartSide: "RIGHT" }, null, 1),
      ev("LINEUP_CONFIRMED", { team: "A", setNumber: 1, playerIds: ["a1", "a2"], liberoId: "a7", secondLiberoId: null }, [0, 0], 5),
      ev("SET_START", { setNumber: 1, firstServer: "B", teamAStartSide: "RIGHT" }, [0, 0], 10),
      ev("RALLY_WON_A", {}, [1, 0], 20),
      ev("SUBSTITUTION", { team: "A", outPlayerId: "a2", inPlayerId: "a1" }, [1, 0], 30),
      ev("LIBERO_REPLACEMENT", { team: "A", liberoId: "a7", direction: "IN", outPlayerId: "a1" }, [1, 0], 40),
      ev("SET_END", { setNumber: 1, winner: "A", scoreA: 25, scoreB: 20 }, [25, 20], 1500),
    ];
    const vsr = buildVsr(report("INDOOR", evs), resolveConfig("INDOOR", {})) as never as {
      version: number;
      city: string;
      hall: string;
      scout: { coinToss: { start: Record<string, string> }; sets: Record<string, unknown>[] };
      settings: Record<string, unknown>;
      officials: Record<string, { firstName: string; lastName: string; level: string }>;
      approvals: { result?: { captain?: { home?: string } } };
    };

    expect(vsr.version).toBe(7);
    expect(vsr.city).toBe("Lausanne");
    expect(vsr.settings.variation).toBe("indoor");
    // Indoor: one match-level coin toss under scout.coinToss.start.
    expect(vsr.scout.coinToss.start).toEqual({ leftSide: "away", serve: "away", winner: "away" });

    const set = vsr.scout.sets[0] as { startingLineup: { home: (number | null)[] }; events: Record<string, Record<string, unknown>>[] };
    // Pre-set lineup applied at SET_START (jersey numbers).
    expect(set.startingLineup.home).toEqual([1, 2]);
    const kinds = set.events.map((e) => Object.keys(e)[0]);
    expect(kinds).toEqual(["rally", "substitution", "libero"]);
    expect(set.events[1]!.substitution).toMatchObject({ team: "home", in: 1, out: 2 });
    expect(set.events[2]!.libero).toMatchObject({ enters: true, libero: 7, player: 1 });

    // Officials mapped to VSR keys with split names.
    expect(vsr.officials.referee1).toEqual({ firstName: "Anna", lastName: "Meier", level: "Int." });
    expect(vsr.officials.scorer1.lastName).toBe("Ian Yu");
    // Post-match captain approval as SVG.
    expect(vsr.approvals.result?.captain?.home).toContain("<svg");
  });

  it("converts strokes to a reference-style SVG and names the file", () => {
    const svg = strokesToSvg({ pad: { w: 1, h: 0.32 }, strokes: [[[0, 0], [1, 1]]] });
    expect(svg).toContain('viewBox="0 0 500 150"');
    expect(svg).toContain("M 0.000,0.000 L 500.000,150.000");
    expect(vsrFilename(report("BEACH", []))).toBe("Match log 12345.vsr");
    expect(vsrFilename({ ...report("BEACH", []), visId: null })).toBe("Match log 9.vsr");
  });
});
