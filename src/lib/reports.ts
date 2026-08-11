// Which reports a given match actually offers (spec/24 §3, §4).
//
// One resolver shared by the Reports tab and the export routes, so the tab can
// never show a download the server would refuse, and the server can never serve
// something the tenant disabled. Client-safe: pure data, no db import.
import {
  OFFICIAL_SHEET_DISCIPLINES,
  REPORT_ROUTES,
  REPORT_TYPES,
  VIEWER_REPORT_TYPES,
  type ReportType,
} from "@/lib/domain";
import type { Discipline } from "@/engine/types";

/**
 * Match statuses whose result is recorded enough to report on (spec/24 A2).
 * ABANDONED is included: a forfeit is still a record, and its sheet is often
 * the document that matters most. Earlier statuses have nothing to report.
 */
const REPORTABLE_STATUSES = [
  "PENDING_CONFIRMATION",
  "FINISHED",
  "ABANDONED",
] as const;

export function isReportableStatus(status: string): boolean {
  return (REPORTABLE_STATUSES as readonly string[]).includes(status);
}

/** A result that exists but is not yet confirmed prints with a provisional mark. */
export function isProvisional(status: string): boolean {
  return status === "PENDING_CONFIRMATION";
}

export interface AvailableReport {
  type: ReportType;
  href: string;
  format: "PDF" | "JSON";
  /** True when this is a match document (any tenant role); false = technical. */
  viewerVisible: boolean;
  /**
   * Set when an official sheet was asked for but this discipline has no official
   * renderer, so the generic scoresheet comes back instead. Surfaced in the UI
   * rather than silently mislabelling the download.
   */
  genericFallback: boolean;
}

/**
 * The reports available for one match, in the canonical REPORT_TYPES order.
 *
 * `canSeeTechnical` reflects the caller's role: the three match documents are
 * open to every tenant role, while the event log and the two JSON exports stay
 * with managers and scorers (spec/24 §1 decision 4).
 */
export function availableReports(opts: {
  matchId: string;
  discipline: Discipline;
  enabledReportTypes: readonly ReportType[];
  canSeeTechnical: boolean;
}): AvailableReport[] {
  return REPORT_TYPES.filter((rt) => opts.enabledReportTypes.includes(rt))
    .filter(
      (rt) => opts.canSeeTechnical || VIEWER_REPORT_TYPES.includes(rt),
    )
    .map((rt) => ({
      type: rt,
      href: REPORT_ROUTES[rt].path(opts.matchId),
      format: REPORT_ROUTES[rt].format,
      viewerVisible: VIEWER_REPORT_TYPES.includes(rt),
      genericFallback:
        rt === "OFFICIAL_SCORESHEET" &&
        !OFFICIAL_SHEET_DISCIPLINES.includes(opts.discipline),
    }));
}

/**
 * Map an export request back to its report type, so a route can check it against
 * the tenant's allow-list. `pdfType` is the `?type=` param (absent ⇒ the default
 * match report).
 */
export function reportTypeForPdf(pdfType: string | null): ReportType {
  switch (pdfType) {
    case "official":
      return "OFFICIAL_SCORESHEET";
    case "sheet":
      return "SCORESHEET";
    case "log":
      return "EVENT_LOG";
    default:
      return "MATCH_REPORT";
  }
}
