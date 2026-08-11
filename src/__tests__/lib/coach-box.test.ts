// The coach box on the official scoresheets (spec/21 gap G4, closed by spec/24
// §2.5). Both renderers printed it blank for want of a coach entity; now that
// team_staff exists, an assigned head coach must actually reach the paper.
//
// pdfkit compresses its content streams, so asserting on the literal glyphs is
// unreliable. Instead: render the same match twice, once with coaches and once
// without, and require the output to differ. That proves the value is consumed
// by the renderer rather than silently dropped — which is exactly the failure
// mode a blank box would hide.
import { describe, expect, it } from "vitest";
import type { MatchReportData } from "@/lib/match-report";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveConfig } from "@/engine/config";

function baseReport(discipline: "BEACH" | "INDOOR"): MatchReportData {
  return {
    matchId: "m_coach",
    discipline,
    status: "FINISHED",
    competitionName: "Coach Box Cup",
    tenantName: "Test",
    teamAName: "Team A",
    teamBName: "Team B",
    teamACountry: "BRA",
    teamBCountry: "ITA",
    roundName: "Final",
    matchNumber: 1,
    courtNumber: 1,
    venue: null,
    city: null,
    country: null,
    hall: null,
    category: null,
    gender: null,
    scheduledAt: new Date("2026-07-28T10:00:00.000Z"),
    startedAt: new Date("2026-07-28T10:00:00.000Z"),
    endedAt: new Date("2026-07-28T11:00:00.000Z"),
    visId: null,
    setsWonA: 2,
    setsWonB: 0,
    winner: "A",
    sets: [],
    events: [],
    approval: {
      confirmedVia: null,
      confirmedAt: null,
      officials: [],
      signatures: [],
    },
    rosterA: [],
    rosterB: [],
    coachA: null,
    coachB: null,
  } as unknown as MatchReportData;
}

async function renderPair(discipline: "BEACH" | "INDOOR") {
  const without = baseReport(discipline);
  const with_ = {
    ...baseReport(discipline),
    coachA: "Ferreira, Bernardinho",
    coachB: "Velasco, Julio",
  };
  const cfg = resolveConfig(discipline, {});
  const render = discipline === "BEACH" ? renderBeachOfficialPdf : renderIndoorOfficialPdf;
  return {
    without: await render(without, buildOfficialSheetData(without), cfg),
    with_: await render(with_, buildOfficialSheetData(with_), cfg),
  };
}

describe("official scoresheet coach box (spec/21 G4)", () => {
  it("indoor sheet changes when a head coach is assigned", async () => {
    const { without, with_ } = await renderPair("INDOOR");
    expect(with_.subarray(0, 5).toString()).toBe("%PDF-");
    expect(Buffer.compare(without, with_)).not.toBe(0);
  });

  it("beach sheet changes when a head coach is assigned", async () => {
    const { without, with_ } = await renderPair("BEACH");
    expect(with_.subarray(0, 5).toString()).toBe("%PDF-");
    expect(Buffer.compare(without, with_)).not.toBe(0);
  });

  it("still renders a valid sheet with no coach assigned (the old behaviour)", async () => {
    for (const d of ["BEACH", "INDOOR"] as const) {
      const { without } = await renderPair(d);
      expect(without.subarray(0, 5).toString()).toBe("%PDF-");
      expect(without.length).toBeGreaterThan(10000);
    }
  });
});
