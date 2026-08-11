// Server-side gate for every report download (spec/24 §3.3).
//
// Two checks, both of which the Reports tab also applies when deciding what to
// render — but the tab is presentation, this is enforcement. A direct URL must
// be refused just as firmly as a hidden link:
//
//  1. Role. The three match documents are open to any member of the match's
//     tenant (decision 4); the event log and the two JSON exports stay with
//     managers and scorers, because they expose the full event stream.
//  2. The tenant's report allow-list. A disabled report type is 404, not 403 —
//     a tenant that switched a document off should not have its existence
//     advertised back to callers.
import { authorizeMatch, SCORING_ROLES, VIEW_ROLES } from "@/lib/authz";
import { VIEWER_REPORT_TYPES, type ReportType } from "@/lib/domain";
import { getTenantConfigById } from "@/lib/tenant";

export type ReportAuthResult =
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 403 | 404 };

export async function authorizeReport(
  matchId: string,
  reportType: ReportType,
): Promise<ReportAuthResult> {
  const needed = VIEWER_REPORT_TYPES.includes(reportType)
    ? VIEW_ROLES
    : SCORING_ROLES;
  const authed = await authorizeMatch(matchId, needed);
  if (!authed.ok) return { ok: false, status: authed.status };

  const config = await getTenantConfigById(authed.auth.tenantId);
  if (!config.enabledReportTypes.includes(reportType))
    return { ok: false, status: 404 };

  return { ok: true, tenantId: authed.auth.tenantId };
}
