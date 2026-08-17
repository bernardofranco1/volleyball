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
import {
  beachGolden,
  events,
  indoorGolden,
  playSet,
  report,
} from "./golden-fixtures";

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

// ── the correction must reach every current-state document (spec/30 Phase B) ─
//
// The fault-correction fixture caught the sheet reading a stale per-row score
// cache. The VSR feed and the timings export walked the same survivors and
// stamped scores from that same cache — so they would have contradicted the
// sheet built from the identical log. One shared counted walk now serves all
// three; this is the fixture that proves they agree.

describe("fault correction — every document agrees", () => {
  /** A's two mid-set points cancelled; B's point inside the window survives. */
  function correctedMatch(): MatchReportData {
    const ev = events();
    const evs: ReportEvent[] = [
      ev("MATCH_CREATED", { matchId: "golden" }, null, null),
      ev("COIN_TOSS", { firstServer: "A", teamAStartSide: "LEFT" }, null, null),
      ev("MATCH_START", {}, null, null),
      ev("SET_START", { setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" }, [0, 0]),
      ev("RALLY_START", {}, [0, 0]),
      ev("RALLY_WON_A", {}, [1, 0]),
      ev("RALLY_WON_A", {}, [2, 0]), // g7 — at fault
      ev("RALLY_WON_B", {}, [2, 1]),
      ev("RALLY_WON_A", {}, [3, 1]), // g9 — at fault
      ev("ROTATION_FAULT", { team: "A" }, [3, 1]),
      ev("UNDO", { targetEventId: "g7" }, [3, 1]),
      ev("UNDO", { targetEventId: "g9" }, [3, 1]),
    ];
    return report("INDOOR", evs);
  }

  it("the scoresheet shows the corrected score", () => {
    const sheet = buildOfficialSheetData(correctedMatch());
    expect([sheet.sets[0].scoreA, sheet.sets[0].scoreB]).toEqual([1, 1]);
  });

  it("the VSR feed shows the same corrected score, not the cached one", async () => {
    const { buildVsr } = await import("@/lib/vsr/build");
    const vsr = buildVsr(correctedMatch(), resolveConfig("INDOOR", {})) as {
      scout: { sets: { score: { home: number; away: number } }[] };
    };
    // The cache would have said 3:1 — the score including the points the
    // referee cancelled.
    expect(vsr.scout.sets[0].score).toEqual({ home: 1, away: 1 });
  });

  it("the timings export stamps rallies with the corrected running score", async () => {
    const { computeMatchTimings } = await import("@/lib/timings");
    const t = computeMatchTimings(correctedMatch());
    // Only the two surviving rallies remain, and they count 1:0 then 1:1.
    expect(t.rallies.map((r) => [r.scoreAfter.a, r.scoreAfter.b])).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });
});
