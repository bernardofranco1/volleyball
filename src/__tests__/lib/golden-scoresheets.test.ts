/**
 * Golden scoresheet fixtures (spec/29 F7).
 *
 * Two reference matches, built as EVENT LOGS and rendered end to end. These are
 * the regression net every other spec/29 phase leans on: the sheet is supposed
 * to be a deterministic rendering of the log, so a fixture that fixes the log
 * fixes the sheet, and any change that quietly alters what a match looks like
 * on paper has to show up here.
 *
 * (spec/29 sequenced F7 into Phase 6, i.e. AFTER the phases it gates. Built
 * with Phase 6 as scheduled, but the sequencing note in the spec's Revalidation
 * section stands: these belong in front of the work they protect.)
 *
 * What is asserted, deliberately:
 *   - the structured sheet data — scores, sets, ladders, service rounds,
 *     sanctions, remarks — because that IS the content of the document;
 *   - geometry spot checks on the rendered PDF — page size and a plausible
 *     byte count — because a renderer that throws or emits an empty page is
 *     the failure mode a data-only assertion misses.
 *
 * Not asserted: a pixel or text diff against the checked-in FIVB reference
 * PDFs in spec/reference/. Those are the LAYOUT source of truth and were
 * matched by eye during spec/21; extracting their text to diff automatically
 * is a separate piece of work, and pretending a byte-count check is that would
 * be worse than saying so.
 */
import { describe, expect, it } from "vitest";
import type { MatchReportData, ReportEvent } from "@/lib/match-report";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveConfig } from "@/engine/config";
import { PAGE_H, PAGE_W } from "@/lib/scoresheet/primitives";

const T0 = new Date("2026-08-17T14:00:00.000Z");

function events() {
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

function player(id: string, n: number, name: string, extra: object = {}) {
  return {
    id,
    jerseyName: name,
    jerseyNumber: n,
    isCaptain: false,
    isLibero: false,
    ...extra,
  };
}

function report(
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
function playSet(
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

function beachGolden(): MatchReportData {
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

function indoorGolden(): MatchReportData {
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

describe("golden fixture — beach reference match (LAT 2:1 USA)", () => {
  const rep = beachGolden();
  const sheet = buildOfficialSheetData(rep);

  it("reconstructs every set's final score from the log alone", () => {
    expect(sheet.sets.map((s) => [s.scoreA, s.scoreB])).toEqual([
      [21, 19],
      [17, 21],
      [15, 12],
    ]);
    expect(sheet.sets.map((s) => s.winner)).toEqual(["A", "B", "A"]);
  });

  it("keeps the coin-toss winner, which no score can imply", () => {
    expect(sheet.tossWinnerSet1).toBe("A");
  });

  it("builds service rounds for both teams in every set", () => {
    for (const s of sheet.sets) {
      expect(s.serviceA.length).toBeGreaterThan(0);
      expect(s.serviceB.length).toBeGreaterThan(0);
    }
  });

  it("has nothing to remark on for a clean match", () => {
    // A quiet match must produce a quiet REMARKS block: anything appearing here
    // would mean the composer is inventing lines.
    expect(sheet.remarks).toEqual([]);
    expect(sheet.sanctions).toEqual([]);
    expect(sheet.protests).toEqual([]);
    expect(sheet.forfeit).toBeNull();
  });

  it("renders a landscape A4 PDF of a plausible size", async () => {
    const pdf = await renderBeachOfficialPdf(rep, sheet, resolveConfig("BEACH", {}));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20000);
    // Geometry: the page box the renderer was built against.
    expect(pdf.toString("latin1")).toContain(`[0 0 ${PAGE_W} ${PAGE_H}]`);
  });
});

describe("golden fixture — indoor reference match (TUR 3:1 BRA)", () => {
  const rep = indoorGolden();
  const sheet = buildOfficialSheetData(rep);

  it("reconstructs all four sets", () => {
    expect(sheet.sets.map((s) => [s.scoreA, s.scoreB])).toEqual([
      [25, 22],
      [20, 25],
      [25, 18],
      [25, 23],
    ]);
    expect(sheet.sets.map((s) => s.winner)).toEqual(["A", "B", "A", "A"]);
  });

  it("carries the starting six into the sheet's lineup row", () => {
    expect(sheet.sets[0].lineupA).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sheet.sets[0].lineupB).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("renders with a rostered coach and libero present", async () => {
    const pdf = await renderIndoorOfficialPdf(rep, sheet, resolveConfig("INDOOR", {}));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20000);
    expect(pdf.toString("latin1")).toContain(`[0 0 ${PAGE_W} ${PAGE_H}]`);
  });
});

// ── The two extra fixtures spec/29 Phase 6 asks for ─────────────────────────

describe("golden fixture — forfeit", () => {
  it("prints a no-show as the convention result, not a blank ladder", () => {
    const ev = events();
    const evs = [
      ev("MATCH_CREATED", { matchId: "golden" }, null, null),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
      ev("FORFEIT", { team: "B", reason: "FORFEIT" }, [0, 0], 1),
    ];
    const sheet = buildOfficialSheetData(report("INDOOR", evs));
    expect(sheet.forfeit).toEqual({ team: "B", reason: "FORFEIT", noShow: true });
    expect(sheet.remarks.some((r) => r.includes("forfeit"))).toBe(true);
  });

  it("does NOT call a retirement mid-match a no-show", () => {
    // 6.4.3: points already played are kept, so the ladder is real.
    const ev = events();
    const evs: ReportEvent[] = [
      ev("MATCH_CREATED", { matchId: "golden" }, null, null),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
      ev("MATCH_START", {}, null, null),
    ];
    playSet(ev, evs, 1, "A", 25, 20, "A");
    evs.push(ev("SET_START", { setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" }, [0, 0], 2));
    evs.push(ev("RALLY_WON_A", {}, [1, 0], 2));
    evs.push(ev("FORFEIT", { team: "B", reason: "RETIREMENT" }, [1, 0], 2));
    const sheet = buildOfficialSheetData(report("INDOOR", evs));
    expect(sheet.forfeit?.noShow).toBe(false);
  });

  it("renders the forfeited sheet", async () => {
    const ev = events();
    const evs = [
      ev("MATCH_CREATED", { matchId: "golden" }, null, null),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
      ev("FORFEIT", { team: "A", reason: "FORFEIT" }, [0, 0], 1),
    ];
    const rep = report("BEACH", evs);
    const pdf = await renderBeachOfficialPdf(
      rep,
      buildOfficialSheetData(rep),
      resolveConfig("BEACH", {}),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("golden fixture — fault correction", () => {
  it("shows the cancelled points gone from the ladder and the fault in REMARKS", () => {
    const ev = events();
    const evs: ReportEvent[] = [
      ev("MATCH_CREATED", { matchId: "golden" }, null, null),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
      ev("MATCH_START", {}, null, null),
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("RALLY_WON_A", {}, [1, 0]),
      ev("RALLY_WON_A", {}, [2, 0]), // g6 — scored while at fault
      ev("RALLY_WON_B", {}, [2, 1]),
      ev("RALLY_WON_A", {}, [3, 1]), // g8 — scored while at fault
      ev("ROTATION_FAULT", { team: "A" }, [3, 1]),
    ];
    // The correction: A's two points inside the window are undone; B's is not.
    evs.push(ev("UNDO", { targetEventId: "g6" }, [3, 1]));
    evs.push(ev("UNDO", { targetEventId: "g8" }, [3, 1]));

    const sheet = buildOfficialSheetData(report("INDOOR", evs));
    const s = sheet.sets[0];
    // A keeps only the point scored before the fault; B keeps theirs — which is
    // the asymmetry a REWIND could not have produced.
    expect(s.scoreA).toBe(1);
    expect(s.scoreB).toBe(1);
    expect(sheet.remarks.some((r) => r.includes("rotation fault"))).toBe(true);
  });
});
