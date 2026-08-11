// Per-tenant capability config (spec/24 §2.1, §4, §5).
//
// The resolver is the safety net for the whole feature: the lists are jsonb, so
// a hand-edited row, a restored backup from an older schema, or a renamed enum
// member all arrive here as arbitrary data. Every failure mode must degrade to
// "everything enabled" — the pre-feature behaviour — rather than locking a
// tenant out of creating competitions or leaving its Reports tab blank.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_CONFIG,
  resolveTenantConfig,
} from "@/lib/tenant";
import {
  CORE_REPORT_TYPES,
  DISCIPLINES,
  REPORT_ROUTES,
  REPORT_TYPES,
  VIEWER_REPORT_TYPES,
  isReportType,
} from "@/lib/domain";

describe("resolveTenantConfig", () => {
  it("no row ⇒ everything enabled (existing tenants unchanged)", () => {
    expect(resolveTenantConfig(null)).toEqual(DEFAULT_TENANT_CONFIG);
    expect(resolveTenantConfig(null).enabledDisciplines).toEqual([...DISCIPLINES]);
  });

  it("null columns ⇒ everything enabled", () => {
    expect(
      resolveTenantConfig({
        enabledDisciplines: null,
        enabledReportTypes: null,
      }),
    ).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it("keeps a stored subset", () => {
    const c = resolveTenantConfig({
      enabledDisciplines: ["BEACH", "INDOOR"],
      enabledReportTypes: ["OFFICIAL_SCORESHEET"],
    });
    expect(c.enabledDisciplines).toEqual(["BEACH", "INDOOR"]);
    expect(c.enabledReportTypes).toEqual(["OFFICIAL_SCORESHEET"]);
  });

  it("drops unknown members but keeps the recognised ones", () => {
    const c = resolveTenantConfig({
      enabledDisciplines: ["BEACH", "SNOW", 42, null],
      enabledReportTypes: ["MATCH_REPORT", "HOLOGRAM"],
    });
    expect(c.enabledDisciplines).toEqual(["BEACH"]);
    expect(c.enabledReportTypes).toEqual(["MATCH_REPORT"]);
  });

  it("an empty array falls back to all — never lock a tenant out", () => {
    const c = resolveTenantConfig({
      enabledDisciplines: [],
      enabledReportTypes: [],
    });
    expect(c.enabledDisciplines).toEqual([...DISCIPLINES]);
    expect(c.enabledReportTypes).toEqual([...REPORT_TYPES]);
  });

  it("an all-garbage array falls back to all rather than to nothing", () => {
    const c = resolveTenantConfig({
      enabledDisciplines: ["NOPE"],
      enabledReportTypes: [{ x: 1 }],
    });
    expect(c.enabledDisciplines).toEqual([...DISCIPLINES]);
    expect(c.enabledReportTypes).toEqual([...REPORT_TYPES]);
  });

  it("a non-array (object, string, number) falls back to all", () => {
    for (const bad of [{}, "BEACH", 7, true]) {
      expect(
        resolveTenantConfig({ enabledDisciplines: bad, enabledReportTypes: bad }),
      ).toEqual(DEFAULT_TENANT_CONFIG);
    }
  });
});

describe("report type domain (spec/24 §4.1)", () => {
  it("every report type has a route and a format", () => {
    for (const rt of REPORT_TYPES) {
      expect(REPORT_ROUTES[rt]).toBeDefined();
      expect(REPORT_ROUTES[rt].path("m1")).toContain("m1");
      expect(["PDF", "JSON"]).toContain(REPORT_ROUTES[rt].format);
    }
  });

  it("viewer-visible types are exactly the three match documents", () => {
    expect([...VIEWER_REPORT_TYPES]).toEqual([
      "OFFICIAL_SCORESHEET",
      "SCORESHEET",
      "MATCH_REPORT",
    ]);
    // The technical exports must NOT be viewer-visible (decision 4).
    for (const rt of ["EVENT_LOG", "VSR_LOG", "TIMINGS"] as const) {
      expect(VIEWER_REPORT_TYPES).not.toContain(rt);
    }
  });

  it("the 'keep one enabled' rule covers only match documents", () => {
    expect([...CORE_REPORT_TYPES]).toEqual([...VIEWER_REPORT_TYPES]);
  });

  it("isReportType guards the enum", () => {
    expect(isReportType("MATCH_REPORT")).toBe(true);
    expect(isReportType("match_report")).toBe(false);
    expect(isReportType("")).toBe(false);
  });

  it("the three PDF match documents map to distinct export URLs", () => {
    const urls = VIEWER_REPORT_TYPES.map((rt) => REPORT_ROUTES[rt].path("m1"));
    expect(new Set(urls).size).toBe(urls.length);
  });
});
