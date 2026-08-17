import { describe, expect, it } from "vitest";
import { removedByCorrections, renderLogPdf, renderPdf } from "@/lib/match-report-pdf";
import { renderScoresheetPdf } from "@/lib/scoresheet-pdf";
import type { MatchReportData, ReportEvent } from "@/lib/match-report";

// Render-level test of the event-log PDF: fabricated match data through the
// real renderer — catches describeLogEvent regressions and PDFKit breakage
// without a database.

const TS = new Date("2026-07-01T10:00:00.000Z");

function ev(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown> | null,
  setNumber: number | null = 1,
  score: [number, number] | null = [1, 0],
): ReportEvent {
  return {
    id: `evt_${sequence}`,
    sequence,
    eventType,
    setNumber,
    scoreAfterA: score?.[0] ?? null,
    scoreAfterB: score?.[1] ?? null,
    timestamp: TS,
    actor: "SCORER",
    notes: null,
    payload,
  };
}

const DATA: MatchReportData = {
  matchId: "m1",
  discipline: "BEACH",
  competitionName: "Beach Open",
  tenantName: "Demo Tenant",
  scoresheetLogoUrl: null,
  teamAName: "Rossi / Bianchi",
  teamBName: "Silva / Costa",
  teamACountry: "ITA",
  teamBCountry: "BRA",
  roundName: "Final",
  matchNumber: 108,
  visId: null,
  phaseName: "Main Draw",
  venue: "Centre Court",
  city: "Rome",
  timezone: null,
  country: "Italy",
  hall: "Foro Italico",
  category: "SENIOR",
  gender: "WOMEN",
  courtNumber: 1,
  scheduledAt: TS,
  startedAt: TS,
  finishedAt: TS,
  status: "FINISHED",
  setsWonA: 2,
  setsWonB: 0,
  winner: "A",
  sets: [],
  approval: { confirmedVia: null, confirmedAt: null, officials: [], signatures: [] },
  coachA: null,
  coachB: null,
  rosterA: [
    { id: "p1", jerseyName: "Marco Rossi", jerseyNumber: 1, isCaptain: true, isLibero: false },
    { id: "p2", jerseyName: "Luca Bianchi", jerseyNumber: 2, isCaptain: false, isLibero: false },
  ],
  rosterB: [
    { id: "p3", jerseyName: "João Silva", jerseyNumber: 1, isCaptain: true, isLibero: false },
    { id: "p4", jerseyName: "Pedro Costa", jerseyNumber: 2, isCaptain: false, isLibero: false },
  ],
  events: [
    ev(1, "MATCH_CREATED", { matchId: "m1" }, null, null),
    ev(2, "COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
    ev(3, "MATCH_START", {}, null, null),
    ev(4, "SET_START", { setNumber: 1, firstServer: "A" }, 1, [0, 0]),
    ev(5, "SERVICE_ORDER", { team: "A", firstServerPlayerId: "p1" }, 1, [0, 0]),
    ev(6, "RALLY_WON_A", {}, 1, [1, 0]),
    ev(7, "REPLAY_POINT", {}, 1, [1, 0]),
    ev(8, "TIMEOUT_REQUEST", { team: "B" }, 1, [1, 0]),
    ev(9, "TIMEOUT_END", { team: "B" }, 1, [1, 0]),
    ev(10, "SIDE_SWITCH", { newTeamASide: "RIGHT" }, 1, [4, 3]),
    ev(11, "SET_END", { setNumber: 1, winner: "A", scoreA: 21, scoreB: 12 }, 1, [21, 12]),
    ev(12, "FORFEIT", { team: "B", reason: "RETIREMENT" }, 2, [0, 0]),
    ev(13, "UNDO", { targetEventId: "x" }, 2, null),
    ev(14, "NOTE", { text: "protest noted" }, 2, null),
  ],
};

describe("event-log PDF export", () => {
  it("renders a non-trivial PDF from a full event mix", async () => {
    const pdf = await renderLogPdf(DATA);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("renders an empty log without crashing", async () => {
    const pdf = await renderLogPdf({ ...DATA, events: [] });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders corrections (UNDO target + REWIND reason) without crashing", async () => {
    const events = [
      ev(1, "MATCH_CREATED", { matchId: "m1" }, null, null),
      ev(2, "RALLY_WON_A", {}, 1, [1, 0]),
      ev(3, "RALLY_WON_B", {}, 1, [1, 1]),
      ev(4, "UNDO", { targetEventId: "evt_3" }, 1, [1, 0]),
      ev(5, "RALLY_WON_A", {}, 1, [2, 0]),
      { ...ev(6, "REWIND", { toSequence: 2 }, 1, [1, 0]), notes: "referee protest upheld" },
    ];
    const pdf = await renderLogPdf({ ...DATA, events });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

// ── Correction survivor pass (audit annotations) ────────────────────────────

describe("removedByCorrections", () => {
  it("maps UNDO targets and REWIND-truncated rows to their correction", () => {
    const events = [
      ev(1, "MATCH_CREATED", null, null, null),
      ev(2, "RALLY_WON_A", {}, 1, [1, 0]),
      ev(3, "RALLY_WON_B", {}, 1, [1, 1]),
      ev(4, "UNDO", { targetEventId: "evt_3" }, 1, [1, 0]),
      ev(5, "RALLY_WON_A", {}, 1, [2, 0]),
      ev(6, "REWIND", { toSequence: 2 }, 1, [1, 0]),
      // re-scored after the rewind — must NOT be marked removed
      ev(7, "RALLY_WON_B", {}, 1, [1, 1]),
    ];
    const removed = removedByCorrections(events);
    expect(removed.get("evt_3")).toBe("undo #4");
    expect(removed.get("evt_5")).toBe("rewind #6");
    expect(removed.has("evt_2")).toBe(false); // at/below the rewind cutoff
    expect(removed.has("evt_7")).toBe(false); // appended after the rewind
    expect(removed.has("evt_4")).toBe(false); // control markers never removed
  });

  it("an UNDO whose target was already rewound away maps nothing", () => {
    const events = [
      ev(1, "RALLY_WON_A", {}, 1, [1, 0]),
      ev(2, "REWIND", { toSequence: 0 }, 1, [0, 0]),
      ev(3, "UNDO", { targetEventId: "evt_1" }, 1, [0, 0]),
    ];
    const removed = removedByCorrections(events);
    expect(removed.get("evt_1")).toBe("rewind #2");
    expect(removed.size).toBe(1);
  });
});

// ── Match report: APPROVAL block (spec/20) ──────────────────────────────────

const SIGNED: MatchReportData = {
  ...DATA,
  sets: [
    {
      setNumber: 1,
      scoreA: 21,
      scoreB: 15,
      winner: "A",
      startedAt: TS.toISOString(),
      endedAt: TS.toISOString(),
      timeoutsUsedA: 1,
      timeoutsUsedB: 0,
      ttoFired: true,
    },
    {
      setNumber: 2,
      scoreA: 21,
      scoreB: 18,
      winner: "A",
      startedAt: TS.toISOString(),
      endedAt: TS.toISOString(),
      timeoutsUsedA: 1,
      timeoutsUsedB: 0,
      ttoFired: true,
    },
  ],
  approval: {
    confirmedVia: "SIGNATURES",
    confirmedAt: TS,
    officials: [
      { role: "FIRST_REFEREE", name: "Amantino G.", country: null, level: null, source: "MANUAL", personId: null },
    ],
    signatures: [
      {
        id: "s1",
        role: "TEAM_A_CAPTAIN",
        signerName: "Rossi M.",
        signerPlayerId: "p1",
        strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0.1, 0.2], [0.5, 0.1], [0.9, 0.25]]] },
        intent: "ACCEPT",
        remarks: null,
        signedAt: TS,
        signedSequence: 14,
        resultDigest: "abc123def4567890",
        capturedBy: "u1",
      },
      {
        id: "s2",
        role: "TEAM_B_CAPTAIN",
        signerName: "Silva J.",
        signerPlayerId: "p3",
        strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0.2, 0.2]]] }, // a dot
        intent: "PROTEST",
        remarks: "Disputes the last point of set 2",
        signedAt: TS,
        signedSequence: 14,
        resultDigest: "abc123def4567890",
        capturedBy: "u1",
      },
      {
        id: "s3",
        role: "FIRST_REFEREE",
        signerName: "Amantino G.",
        signerPlayerId: null,
        strokes: null, // refused — no mark, reason recorded
        intent: "REFUSED",
        remarks: "Left before signing",
        signedAt: TS,
        signedSequence: 14,
        resultDigest: "abc123def4567890",
        capturedBy: "u1",
      },
    ],
  },
};

describe("match report approval block", () => {
  it("renders signatures, a protest remark and a refusal", async () => {
    const pdf = await renderPdf(SIGNED);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Signed sheets carry more drawing than an unsigned one.
    const unsigned = await renderPdf(DATA);
    expect(pdf.length).toBeGreaterThan(unsigned.length);
  });

  it("handles a manager-confirmed result with no signatures", async () => {
    const pdf = await renderPdf({
      ...DATA,
      approval: { confirmedVia: "ADMIN", confirmedAt: TS, officials: [], signatures: [] },
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

// ── Official scoresheet (?type=sheet) ───────────────────────────────────────

describe("official scoresheet export", () => {
  it("renders the signed sheet in landscape with every block", async () => {
    const pdf = await renderScoresheetPdf(SIGNED);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // A4 landscape: 842 x 595pt (MediaBox width > height).
    const head = pdf.subarray(0, 2000).toString("latin1");
    expect(head).toMatch(/MediaBox\s*\[\s*0\s+0\s+841\.89\s+595\.28\s*\]/);
    expect(pdf.length).toBeGreaterThan(3000);
  });

  // (Plain renderer crash-smokes live in official-scoresheet.test.ts — this
  // file keeps only the two structural contracts: page geometry + clamping.)
  it("survives a signature whose payload is out of range", async () => {
    // Clamping happens in fitStrokes, and the box also clips — a malformed
    // payload must never be able to scrawl across the rest of the sheet.
    const wild = await renderScoresheetPdf({
      ...SIGNED,
      approval: {
        ...SIGNED.approval,
        signatures: [
          {
            ...SIGNED.approval.signatures[0],
            strokes: {
              pad: { w: 1, h: 0.32 },
              strokes: [[[-5, -5], [12, 40], [0.5, 0.5]]],
            },
          },
        ],
      },
    });
    expect(wild.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
