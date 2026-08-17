/**
 * The two reference matches, as event logs (spec/29 F7, shared per spec/30 G).
 *
 * Extracted from golden-scoresheets.test.ts so the content assertions and the
 * PDF text-extraction assertions render the SAME fixtures. Two definitions
 * would let the two suites drift and each keep passing.
 */
import type { MatchReportData, ReportEvent } from "@/lib/match-report";

const T0 = new Date("2026-08-17T14:00:00.000Z");

export function events() {
  let seq = 0;
  return function ev(
    eventType: string,
    payload: Record<string, unknown> = {},
    score: [number, number] | null = null,
    setNumber: number | null = 1,
  ): ReportEvent {
    seq += 1;
    return {
      id: `g${seq}`,
      sequence: seq,
      eventType,
      setNumber,
      scoreAfterA: score?.[0] ?? null,
      scoreAfterB: score?.[1] ?? null,
      timestamp: new Date(T0.getTime() + seq * 1000),
      actor: "SCORER",
      notes: null,
      payload: { type: eventType, ...payload },
    };
  };
}

export function player(id: string, n: number, name: string, extra: object = {}) {
  return {
    id,
    jerseyName: name,
    jerseyNumber: n,
    isCaptain: false,
    isLibero: false,
    ...extra,
  };
}

export function report(
  discipline: "BEACH" | "INDOOR",
  evs: ReportEvent[],
  over: Partial<MatchReportData> = {},
): MatchReportData {
  return {
    matchId: "golden",
    discipline,
    competitionName: discipline === "BEACH" ? "Beach WCH 2025" : "VNL 2026",
    tenantName: "FIVB",
    scoresheetLogoUrl: null,
    teamAName: discipline === "BEACH" ? "LAT" : "TUR",
    teamBName: discipline === "BEACH" ? "USA" : "BRA",
    teamACountry: discipline === "BEACH" ? "LVA" : "TUR",
    teamBCountry: discipline === "BEACH" ? "USA" : "BRA",
    roundName: "Final",
    phaseName: null,
    matchNumber: 1,
    courtNumber: 1,
    venue: "Centre Court",
    city: "Lausanne",
    country: "SUI",
    hall: "Arena",
    timezone: "Europe/Zurich",
    category: "SENIOR",
    gender: "WOMEN",
    status: "FINISHED",
    scheduledAt: T0,
    startedAt: T0,
    finishedAt: new Date(T0.getTime() + 90 * 60000),
    setsWonA: 0,
    setsWonB: 0,
    winner: null,
    sets: [],
    approval: {
      confirmedVia: "SIGNATURES",
      officials: [],
      signatures: [],
    },
    coachA: null,
    coachB: null,
    rosterA: [],
    rosterB: [],
    events: evs,
    ...over,
  } as MatchReportData;
}

/** Play a set out to `to`-`opp`, alternating so both teams take service turns. */
export function playSet(
  ev: ReturnType<typeof events>,
  out: ReportEvent[],
  setNumber: number,
  winner: "A" | "B",
  target: number,
  loserScore: number,
  firstServer: "A" | "B" = "A",
) {
  out.push(
    ev("SET_START", { setNumber, firstServer, teamAStartSide: "LEFT" }, [0, 0], setNumber),
  );
  let a = 0;
  let b = 0;
  const winA = winner === "A";
  while (a < (winA ? target : loserScore) || b < (winA ? loserScore : target)) {
    const giveA = winA ? a < target : a < loserScore;
    const giveB = winA ? b < loserScore : b < target;
    // Alternate while both still need points, so service turns change hands.
    if (giveA && (!giveB || (a + b) % 2 === 0)) {
      a += 1;
      out.push(ev("RALLY_WON_A", {}, [a, b], setNumber));
    } else if (giveB) {
      b += 1;
      out.push(ev("RALLY_WON_B", {}, [a, b], setNumber));
    } else break;
  }
  out.push(
    ev("SET_END", { setNumber, winner, scoreA: a, scoreB: b }, [a, b], setNumber),
  );
  return { a, b };
}

// ── Reference match 1: beach, LAT 2:1 USA ───────────────────────────────────

export function beachGolden(): MatchReportData {
  const ev = events();
  const evs: ReportEvent[] = [
    ev("MATCH_CREATED", { matchId: "golden" }, null, null),
    ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT", tossWinner: "A" }, null, null),
    ev("MATCH_START", {}, null, null),
  ];
  playSet(ev, evs, 1, "A", 21, 19, "A");
  playSet(ev, evs, 2, "B", 21, 17, "B");
  playSet(ev, evs, 3, "A", 15, 12, "A");
  evs.push(ev("MATCH_END", { winner: "A", setsA: 2, setsB: 1 }, null, 3));

  return report("BEACH", evs, {
    setsWonA: 2,
    setsWonB: 1,
    winner: "A",
    rosterA: [player("a1", 1, "Graudina", { isCaptain: true }), player("a2", 2, "Samoilova")],
    rosterB: [player("b1", 1, "Nuss", { isCaptain: true }), player("b2", 2, "Kloth")],
  });
}

// ── Reference match 2: indoor, TUR 3:1 BRA ──────────────────────────────────

export function indoorGolden(): MatchReportData {
  const ev = events();
  const six = (t: string) => [1, 2, 3, 4, 5, 6].map((n) => `${t}${n}`);
  const evs: ReportEvent[] = [
    ev("MATCH_CREATED", { matchId: "golden" }, null, null),
    ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT", tossWinner: "B" }, null, null),
    ev("MATCH_START", {}, null, null),
    ev("LINEUP_CONFIRMED", { team: "A", setNumber: 1, playerIds: six("a") }, [0, 0]),
    ev("LINEUP_CONFIRMED", { team: "B", setNumber: 1, playerIds: six("b") }, [0, 0]),
  ];
  playSet(ev, evs, 1, "A", 25, 22, "A");
  playSet(ev, evs, 2, "B", 25, 20, "B");
  playSet(ev, evs, 3, "A", 25, 18, "A");
  playSet(ev, evs, 4, "A", 25, 23, "B");
  evs.push(ev("MATCH_END", { winner: "A", setsA: 3, setsB: 1 }, null, 4));

  return report("INDOOR", evs, {
    setsWonA: 3,
    setsWonB: 1,
    winner: "A",
    rosterA: [
      ...six("a").map((id, i) => player(id, i + 1, `TUR ${i + 1}`, { isCaptain: i === 0 })),
      player("aL", 12, "TUR libero", { isLibero: true }),
      {
        id: "aC",
        jerseyName: "TUR coach",
        jerseyNumber: null,
        isCaptain: false,
        isLibero: false,
        role: "STAFF",
        staffFunction: "C1",
      },
    ],
    rosterB: six("b").map((id, i) => player(id, i + 1, `BRA ${i + 1}`, { isCaptain: i === 0 })),
  });
}

