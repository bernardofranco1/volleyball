// Reports tab + export gating (spec/24 §3).
//
// Two things must never drift apart: what the tab renders, and what the export
// routes will serve. Both go through availableReports/reportTypeForPdf, so these
// tests pin the mapping, the role split (match documents open to any tenant
// role, technical exports not), and the status rule.
import { describe, expect, it } from "vitest";
import {
  availableReports,
  isProvisional,
  isReportableStatus,
  reportTypeForPdf,
} from "@/lib/reports";
import { REPORT_TYPES, type ReportType } from "@/lib/domain";

const ALL = [...REPORT_TYPES];

describe("isReportableStatus (spec/24 A2)", () => {
  it("covers every status that has a result to report on", () => {
    expect(isReportableStatus("FINISHED")).toBe(true);
    expect(isReportableStatus("PENDING_CONFIRMATION")).toBe(true);
    // A forfeit is still a record, and its sheet is often the one that matters.
    expect(isReportableStatus("ABANDONED")).toBe(true);
  });

  it("excludes matches that have not produced a result", () => {
    for (const s of ["SCHEDULED", "WARMUP", "COIN_TOSS", "LIVE"]) {
      expect(isReportableStatus(s)).toBe(false);
    }
  });

  it("marks only an unconfirmed result as provisional", () => {
    expect(isProvisional("PENDING_CONFIRMATION")).toBe(true);
    expect(isProvisional("FINISHED")).toBe(false);
  });
});

describe("reportTypeForPdf", () => {
  it("maps each ?type= value to its report type", () => {
    expect(reportTypeForPdf("official")).toBe("OFFICIAL_SCORESHEET");
    expect(reportTypeForPdf("sheet")).toBe("SCORESHEET");
    expect(reportTypeForPdf("log")).toBe("EVENT_LOG");
  });

  it("absent or unknown ?type= is the default match report, never the log", () => {
    // Important: an unrecognised value must not fall through to a technical
    // export, or it would bypass the stricter role check.
    expect(reportTypeForPdf(null)).toBe("MATCH_REPORT");
    expect(reportTypeForPdf("")).toBe("MATCH_REPORT");
    expect(reportTypeForPdf("nonsense")).toBe("MATCH_REPORT");
    expect(reportTypeForPdf("LOG")).toBe("MATCH_REPORT");
  });
});

describe("availableReports role split (decision 4)", () => {
  const base = {
    matchId: "m1",
    discipline: "INDOOR" as const,
    enabledReportTypes: ALL,
  };

  it("a viewer gets the three match documents and no technical exports", () => {
    const r = availableReports({ ...base, canSeeTechnical: false });
    expect(r.map((x) => x.type)).toEqual([
      "OFFICIAL_SCORESHEET",
      "SCORESHEET",
      "MATCH_REPORT",
    ]);
    expect(r.every((x) => x.viewerVisible)).toBe(true);
  });

  it("a scorer/manager additionally gets the technical exports", () => {
    const r = availableReports({ ...base, canSeeTechnical: true });
    expect(r.map((x) => x.type)).toEqual(ALL);
    expect(r.filter((x) => !x.viewerVisible).map((x) => x.type)).toEqual([
      "EVENT_LOG",
      "VSR_LOG",
      "TIMINGS",
    ]);
  });
});

describe("availableReports honours the tenant allow-list", () => {
  it("offers only enabled types", () => {
    const r = availableReports({
      matchId: "m1",
      discipline: "BEACH",
      enabledReportTypes: ["MATCH_REPORT", "TIMINGS"],
      canSeeTechnical: true,
    });
    expect(r.map((x) => x.type)).toEqual(["MATCH_REPORT", "TIMINGS"]);
  });

  it("an empty allow-list yields nothing (the tab then says so)", () => {
    expect(
      availableReports({
        matchId: "m1",
        discipline: "BEACH",
        enabledReportTypes: [],
        canSeeTechnical: true,
      }),
    ).toEqual([]);
  });

  it("keeps the canonical order regardless of how the config is stored", () => {
    const r = availableReports({
      matchId: "m1",
      discipline: "BEACH",
      enabledReportTypes: ["TIMINGS", "SCORESHEET"] as ReportType[],
      canSeeTechnical: true,
    });
    expect(r.map((x) => x.type)).toEqual(["SCORESHEET", "TIMINGS"]);
  });

  it("every entry carries a usable href containing the match id", () => {
    const r = availableReports({
      matchId: "match_abc",
      discipline: "INDOOR",
      enabledReportTypes: ALL,
      canSeeTechnical: true,
    });
    for (const x of r) expect(x.href).toContain("match_abc");
  });
});

describe("official-sheet fallback is disclosed, not hidden", () => {
  const enabled: ReportType[] = ["OFFICIAL_SCORESHEET"];

  it("beach and indoor have a real official sheet", () => {
    for (const d of ["BEACH", "INDOOR"] as const) {
      const [r] = availableReports({
        matchId: "m1",
        discipline: d,
        enabledReportTypes: enabled,
        canSeeTechnical: false,
      });
      expect(r.genericFallback).toBe(false);
    }
  });

  it("grass and light are flagged as falling back to the generic sheet", () => {
    for (const d of ["GRASS", "LIGHT"] as const) {
      const [r] = availableReports({
        matchId: "m1",
        discipline: d,
        enabledReportTypes: enabled,
        canSeeTechnical: false,
      });
      // The export route already substitutes the generic renderer; the UI must
      // say so rather than offering an "official sheet" it cannot produce.
      expect(r.genericFallback).toBe(true);
    }
  });
});
