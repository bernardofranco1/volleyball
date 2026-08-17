import { describe, expect, it } from "vitest";
import type { MatchReportData, ReportEvent } from "@/lib/match-report";
import {
  buildOfficialSheetData,
  survivingEvents,
} from "@/lib/scoresheet/official-data";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveConfig } from "@/engine/config";

// Official-scoresheet data layer + renderer smoke tests (spec/21 Phase E,
// first slice): a fabricated beach set exercises side-out attribution, the
// set-end circling convention, switches/TTO, timeouts, sanctions and UNDO
// survivor semantics; both renderers must emit a real PDF from the result.

const T0 = new Date("2026-07-28T10:00:00.000Z");

/** Event factory with its own sequence counter — no shared mutable state. */
function eventFactory() {
  let seq = 0;
  return function ev(
  eventType: string,
  payload: Record<string, unknown>,
  score: [number, number] | null,
  setNumber: number | null = 1,
  offsetSec = 0,
): ReportEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    sequence: seq,
    eventType,
    setNumber,
    scoreAfterA: score?.[0] ?? null,
    scoreAfterB: score?.[1] ?? null,
    timestamp: new Date(T0.getTime() + (offsetSec || seq) * 1000),
    actor: "SCORER",
    notes: null,
    payload: { type: eventType, ...payload },
  };
  };
}

function baseReport(discipline: string, events: ReportEvent[]): MatchReportData {
  return {
    matchId: "m1",
    discipline,
    competitionName: "Test Open",
    tenantName: "Tenant",
    scoresheetLogoUrl: null,
    teamAName: discipline === "BEACH" ? "Duda/Ana" : "Lausanne UC",
    teamBName: discipline === "BEACH" ? "Nuss/Brasher" : "Volley SW",
    teamACountry: "BRA",
    teamBCountry: "USA",
    roundName: "Final",
    matchNumber: 1,
  visId: null,
    phaseName: "Main Draw",
    venue: "Centre Court",
    city: "Lausanne",
    country: "Switzerland",
    hall: "Malley",
    category: "SENIOR",
    gender: "WOMEN",
    courtNumber: 1,
    scheduledAt: T0,
    startedAt: T0,
    finishedAt: new Date(T0.getTime() + 40 * 60000),
    status: "FINISHED",
    setsWonA: 1,
    setsWonB: 0,
    winner: "A",
    sets: [],
    events,
    approval: {
      confirmedVia: null,
      confirmedAt: null,
      officials: [],
      // A pre-match captain and a scorer signature exercise the Phase D
      // drawing paths (TEAMS pre-match box + APPROVAL bench row).
      signatures: [
        {
          id: "sig1",
          role: "TEAM_A_CAPTAIN_PREMATCH",
          signerName: "Duda Lisboa",
          signerPlayerId: "a1",
          strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0.1, 0.5], [0.9, 0.5]]] },
          intent: "ACCEPT",
          remarks: null,
          signedAt: T0,
          signedSequence: 3,
          resultDigest: "d1",
          capturedBy: null,
        },
        {
          id: "sig2",
          role: "SCORER",
          signerName: "Dundas W.",
          signerPlayerId: null,
          strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0.2, 0.3], [0.8, 0.7]]] },
          intent: "ACCEPT",
          remarks: null,
          signedAt: T0,
          signedSequence: 30,
          resultDigest: "d2",
          capturedBy: null,
        },
      ],
    },
    coachA: null,
    coachB: null,
    rosterA: [
      { id: "a1", jerseyName: "Duda Lisboa", jerseyNumber: 1, isCaptain: true, isLibero: false },
      { id: "a2", jerseyName: "Ana Patricia", jerseyNumber: 2, isCaptain: false, isLibero: false },
    ],
    rosterB: [
      { id: "b1", jerseyName: "Kristen Nuss", jerseyNumber: 1, isCaptain: true, isLibero: false },
      { id: "b2", jerseyName: "Taryn Brasher", jerseyNumber: 2, isCaptain: false, isLibero: false },
    ],
  };
}

function beachEvents(): ReportEvent[] {
  const ev = eventFactory();
  const evs: ReportEvent[] = [
    ev("MATCH_CREATED", { matchId: "m1" }, null, null),
    ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT", tossWinner: "B" }, null, null),
    ev("MATCH_START", {}, null, null),
    ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
    ev("SERVICE_ORDER", { team: "A", firstServerPlayerId: "a2" }, [0, 0]),
    ev("SERVICE_ORDER", { team: "B", firstServerPlayerId: "b1" }, [0, 0]),
  ];
  // A serves and wins 2 points (1:0, 2:0), then loses the rally (2:1) →
  // side-out recorded for A at score 2, player slot 0.
  evs.push(ev("RALLY_WON_A", {}, [1, 0]));
  evs.push(ev("RALLY_WON_A", {}, [2, 0]));
  evs.push(ev("RALLY_WON_B", {}, [2, 1]));
  // B loses serve straight away (3:1) → side-out for B at score 1, slot 0.
  evs.push(ev("RALLY_WON_A", {}, [3, 1]));
  // Timeout by B at 3:1.
  evs.push(ev("TIMEOUT_REQUEST", { team: "B" }, [3, 1]));
  evs.push(ev("TIMEOUT_END", { team: "B" }, [3, 1]));
  // A scores to 4:1, sum 5 → court switch (score-stamped). The engine
  // auto-emits SIDE_SWITCH first, then TTO_START at the same score — the TTO
  // flag must land on THAT switch, not the next one (regression: it used to
  // shift one switch late).
  evs.push(ev("RALLY_WON_A", {}, [4, 1]));
  evs.push(ev("SIDE_SWITCH", { newTeamASide: "RIGHT" }, [4, 1]));
  evs.push(ev("TTO_START", {}, [4, 1]));
  // A misconduct warning against player a1 at 4:1.
  evs.push(ev("MISCONDUCT_WARNING", { team: "A", playerId: "a1" }, [4, 1]));
  // An improper request by B.
  evs.push(ev("IMPROPER_REQUEST", { team: "B" }, [4, 1]));
  // A point that gets undone (UNDO must erase it from the sheet).
  const undone = ev("RALLY_WON_B", {}, [4, 2]);
  evs.push(undone);
  evs.push(ev("UNDO", { targetEventId: undone.id }, null));
  // Run A to 21:1 — 17 more A points on serve.
  let a = 4;
  for (let i = 0; i < 17; i++) {
    a += 1;
    evs.push(ev("RALLY_WON_A", {}, [a, 1]));
  }
  evs.push(ev("SET_END", { setNumber: 1, winner: "A", scoreA: 21, scoreB: 1 }, [21, 1]));
  evs.push(ev("MATCH_END", { winner: "A", setsA: 1, setsB: 0 }, [21, 1], null));
  return evs;
}

describe("official scoresheet data layer", () => {
  it("reconstructs beach side-outs, circling, switches and sanctions", () => {
    const report = baseReport("BEACH", beachEvents());
    const sheet = buildOfficialSheetData(report);

    expect(sheet.sets).toHaveLength(1);
    const s = sheet.sets[0];
    expect(s.scoreA).toBe(21);
    expect(s.scoreB).toBe(1);
    expect(s.winner).toBe("A");

    // Side-outs: A lost serve once at 2 points (slot 0). A won the set while
    // its slot-1 player held serve → the final 21 is circled in THAT row
    // (the player who served the last time the team scored — never the next
    // server).
    expect(s.serviceA).toEqual([
      { col: 0, round: 0, score: 2, circled: false },
      { col: 1, round: 0, score: 21, circled: true },
    ]);
    // B's only service turn (slot 0) ended at its final score of 1 — the
    // set-end circle MERGES onto that entry instead of duplicating it on the
    // next server's row.
    expect(s.serviceB).toEqual([{ col: 0, round: 0, score: 1, circled: true }]);

    // Service order maps player ids to jerseys: A declared a2 first.
    expect(s.serviceOrderA).toEqual([2, 1]);
    expect(s.serviceOrderB).toEqual([1, 2]);

    // Timeout score-stamped; switch carries the TTO flag.
    expect(s.timeouts).toEqual([{ team: "B", score: { a: 3, b: 1 } }]);
    expect(s.switches).toEqual([{ score: { a: 4, b: 1 }, tto: true }]);

    // Sanction resolved to a jersey; improper request recorded; toss winner kept.
    // `member` is the grid mark — the jersey number for a player, a function
    // letter for a bench official (spec/29 F1).
    expect(sheet.sanctions).toEqual([
      {
        kind: "MISCONDUCT_WARNING",
        team: "A",
        jersey: 1,
        member: "1",
        setNumber: 1,
        score: { a: 4, b: 1 },
      },
    ]);
    expect(sheet.improperRequests).toEqual([{ team: "B", setNumber: 1 }]);
    expect(sheet.tossWinnerSet1).toBe("B");

    // The undone B point never re-appears: B's score stays 1 everywhere.
    expect(s.scoreB).toBe(1);
  });

  it("drops UNDO targets and REWIND tails from the survivor list", () => {
    const ev = eventFactory();
    const a = ev("RALLY_WON_A", {}, [1, 0]);
    const b = ev("RALLY_WON_B", {}, [1, 1]);
    const undo = ev("UNDO", { targetEventId: b.id }, null);
    const c = ev("RALLY_WON_A", {}, [2, 0]);
    const rewind = ev("REWIND", { toSequence: a.sequence }, null);
    const d = ev("RALLY_WON_A", {}, [2, 0]);
    const out = survivingEvents([a, b, undo, c, rewind, d]);
    expect(out.map((e) => e.id)).toEqual([a.id, d.id]);
  });

  it("shifts the receiving team's indoor service rounds by one column", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("LINEUP_CONFIRMED", { team: "A", setNumber: 1, playerIds: ["a1", "a2"] }, [0, 0]),
      // A serves, B wins → A side-out at 0, col 0. B (receiver) then loses at
      // 1 point → B's first entry goes to col 1 (paper: column II).
      ev("RALLY_WON_B", {}, [0, 1]),
      ev("RALLY_WON_A", {}, [1, 1]),
    ];
    const report = baseReport("INDOOR", evs);
    const sheet = buildOfficialSheetData(report);
    const s = sheet.sets[0];
    expect(s.serviceA[0]).toEqual({ col: 0, round: 0, score: 0, circled: false });
    expect(s.serviceB[0]).toEqual({ col: 1, round: 0, score: 1, circled: false });
    expect(s.lineupA).toEqual([1, 2]);
  });
});

describe("official scoresheet renderers", () => {
  it("renders a beach official sheet PDF", async () => {
    const report = baseReport("BEACH", beachEvents());
    const sheet = buildOfficialSheetData(report);
    const pdf = await renderBeachOfficialPdf(report, sheet, resolveConfig("BEACH", {}));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20000);
  });

  it("renders an indoor official sheet PDF", async () => {
    const report = baseReport("INDOOR", beachEvents());
    const sheet = buildOfficialSheetData(report);
    const pdf = await renderIndoorOfficialPdf(report, sheet, resolveConfig("INDOOR", {}));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20000);
  });
});

// ── bench officials on the sheet (spec/29 F1/F2/F3) ─────────────────────────
//
// Staff are roster rows, which is what let the misconduct payload stay
// `playerId`-shaped (§Revalidation §2). The sheet has to tell the two apart:
// a coach prints their function letter where a player prints a number, and a
// coach must never be listed among the players.

function withStaff(report: MatchReportData): MatchReportData {
  return {
    ...report,
    rosterA: [
      ...report.rosterA,
      {
        id: "aC",
        jerseyName: "Coach A",
        jerseyNumber: null,
        isCaptain: false,
        isLibero: false,
        role: "STAFF",
        staffFunction: "C1",
      },
      {
        id: "aD",
        jerseyName: "Doc A",
        jerseyNumber: null,
        isCaptain: false,
        isLibero: false,
        role: "STAFF",
        staffFunction: "D1",
      },
    ],
  };
}

describe("bench officials", () => {
  it("marks a coach's card with the function letter, not a blank", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("RALLY_WON_A", {}, [1, 0]),
      // The coach is targeted by roster-row id, exactly like a player.
      ev("MISCONDUCT_PENALTY", { team: "A", playerId: "aC" }, [1, 0]),
      ev("MISCONDUCT_WARNING", { team: "A", playerId: "a1" }, [1, 0]),
    ];
    const sheet = buildOfficialSheetData(withStaff(baseReport("INDOOR", evs)));
    const coachCard = sheet.sanctions.find((s) => s.kind === "MISCONDUCT_PENALTY");
    const playerCard = sheet.sanctions.find((s) => s.kind === "MISCONDUCT_WARNING");
    expect(coachCard?.member).toBe("C1");
    // A coach has no jersey number — the old `jersey`-only grid printed "•".
    expect(coachCard?.jersey).toBeNull();
    expect(playerCard?.member).toBe("1");
  });

  it("keeps a team-level delay sanction unattributed", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("DELAY_WARNING", { team: "B" }, [0, 0]),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    expect(sheet.sanctions[0].member).toBeNull();
    expect(sheet.sanctions[0].jersey).toBeNull();
  });

  it("renders both sheets with staff rostered and a coach signature", async () => {
    const base = baseReport("BEACH", beachEvents());
    const report: MatchReportData = {
      ...withStaff(base),
      approval: {
        ...base.approval,
        signatures: [
          ...base.approval.signatures,
          {
            ...base.approval.signatures[0],
            role: "TEAM_A_COACH_PREMATCH",
            signerName: "Coach A",
          },
        ],
      },
    };
    const sheet = buildOfficialSheetData(report);
    const beach = await renderBeachOfficialPdf(report, sheet, resolveConfig("BEACH", {}));
    expect(beach.subarray(0, 5).toString()).toBe("%PDF-");
    const indoor = await renderIndoorOfficialPdf(
      { ...report, discipline: "INDOOR" },
      sheet,
      resolveConfig("INDOOR", {}),
    );
    expect(indoor.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ── Phase 4: injury, libero and recovery completeness (spec/29 F9/F10/F11) ──

describe("remarks composed from the log", () => {
  it("records an exceptional substitution — the sub boxes can't show it", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("LINEUP_CONFIRMED", { team: "A", setNumber: 1, playerIds: ["a1", "a2"] }, [0, 0]),
      ev("RALLY_WON_A", {}, [1, 0]),
      ev(
        "SUBSTITUTION",
        { team: "A", outPlayerId: "a1", inPlayerId: "a2", isExceptional: true },
        [1, 0],
      ),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    const line = sheet.remarks.find((r) => r.includes("exceptional substitution"));
    expect(line).toBeDefined();
    expect(line).toContain("Set 1");
    expect(line).toContain("1:0");
  });

  it("leaves an ordinary substitution out of REMARKS", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("SUBSTITUTION", { team: "A", outPlayerId: "a1", inPlayerId: "a2" }, [0, 0]),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    expect(sheet.remarks.some((r) => r.includes("substitution"))).toBe(false);
  });

  it("prints a recovery with the player and the score, counting repeats", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("RALLY_WON_A", {}, [1, 0]),
      ev("MEDICAL_TIMEOUT", { team: "A", playerId: "a1" }, [1, 0]),
      ev("MEDICAL_TIMEOUT_END", {}, [1, 0]),
      ev("RALLY_WON_B", {}, [1, 1]),
      ev("MEDICAL_TIMEOUT", { team: "A", playerId: "a1" }, [1, 1]),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    const recoveries = sheet.remarks.filter((r) => r.includes("medical recovery"));
    expect(recoveries).toHaveLength(2);
    expect(recoveries[0]).toContain("1 Duda Lisboa");
    // The second one for the same player is flagged as such — the per-player
    // limits differ by discipline and the sheet must make repeats visible.
    expect(recoveries[1]).toContain("#2 for this player");
  });

  it("records a libero re-designation with the incoming libero", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("LIBERO_REDESIGNATION", { team: "A", newLiberoId: "a2" }, [0, 0]),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    const line = sheet.remarks.find((r) => r.includes("libero re-designated"));
    expect(line).toBeDefined();
    expect(line).toContain("Ana Patricia");
  });

  it("keeps the scorer's free-text notes in their own words", () => {
    const ev = eventFactory();
    const evs = [
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("NOTE", { text: "Net height re-measured at 2.43 m" }, [0, 0]),
    ];
    const sheet = buildOfficialSheetData(baseReport("INDOOR", evs));
    expect(sheet.remarks).toContain("Net height re-measured at 2.43 m");
  });
});
