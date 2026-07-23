import { describe, expect, it } from "vitest";
import { renderLogPdf } from "@/app/api/matches/[id]/export.pdf/route";
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
  teamAName: "Rossi / Bianchi",
  teamBName: "Silva / Costa",
  roundName: "Final",
  courtNumber: 1,
  scheduledAt: TS,
  startedAt: TS,
  finishedAt: TS,
  status: "FINISHED",
  setsWonA: 2,
  setsWonB: 0,
  winner: "A",
  sets: [],
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
});
