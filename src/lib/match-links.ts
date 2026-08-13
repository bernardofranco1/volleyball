import { isReportableStatus } from "@/lib/reports";

/**
 * Where a match row's primary link goes, by what the viewer can do with it.
 *
 * Lifted out of the match centre so the dashboard, the match centre and the
 * competition surfaces all agree: a match that already has a result opens its
 * Reports tab for everyone (there is nothing left to score, and a viewer had no
 * route to the reports at all before — spec/24 §3.4); otherwise managers get
 * the management hub, scorers the console, and everyone else the public board.
 */
export function matchHref(
  tenantSlug: string,
  match: { id: string; competitionId: string; status: string },
  can: { manage: boolean; score: boolean },
): string {
  const detail = matchBase(tenantSlug, match);
  if (isReportableStatus(match.status)) return `${detail}/reports`;
  if (can.manage) return detail;
  if (can.score) return `${detail}/live`;
  return `/t/${tenantSlug}/scoreboard/${match.id}`;
}

/** The match management hub — base for /live, /reports and the tab bar. */
export function matchBase(
  tenantSlug: string,
  match: { id: string; competitionId: string },
): string {
  return `/t/${tenantSlug}/competitions/${match.competitionId}/matches/${match.id}`;
}
