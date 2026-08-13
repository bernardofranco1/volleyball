// Reports tab for a match (spec/24 §3). A separate route from the admin hub so
// it can be read by ANY tenant role — the hub itself stays ADMIN_ROLES. Which
// documents appear comes from the tenant's allow-list intersected with the
// caller's role; the export routes re-check both, so this page is presentation
// only and hiding a row is never the security boundary.
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireRole, SCORING_ROLES, VIEW_ROLES } from "@/lib/authz";
import { getCompetition, getMatch } from "@/lib/competitions";
import { availableReports, isProvisional, isReportableStatus } from "@/lib/reports";
import { getT } from "@/lib/i18n/server";
import type { Discipline } from "@/engine/types";
import { MatchTabs } from "@/components/admin/MatchTabs";
import { Page } from "@/components/ui/Page";
import { matchStatusLabel, statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const REPORT_LABEL_KEY: Record<string, string> = {
  OFFICIAL_SCORESHEET: "match.exportOfficialSheet",
  SCORESHEET: "match.exportScoresheet",
  MATCH_REPORT: "match.exportPdf",
  EVENT_LOG: "match.exportLogPdf",
  VSR_LOG: "match.exportVsr",
  TIMINGS: "match.exportTimings",
};

export default async function MatchReportsPage({
  params,
}: {
  params: Promise<{
    tenantSlug: string;
    competitionId: string;
    matchId: string;
  }>;
}) {
  const { tenantSlug, competitionId, matchId } = await params;
  const ctx = await requireRole(
    tenantSlug,
    VIEW_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}/reports`,
  );
  const { t } = await getT();

  const [competition, match] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    getMatch(ctx.tenant.id, matchId),
  ]);
  if (!competition) notFound();
  // Guard the URL triple: a match must really belong to this competition, or a
  // hand-edited URL could read across competitions inside the tenant.
  if (!match || match.competitionId !== competitionId) notFound();

  const canManage = hasRole(ctx.roles, ["COMPETITION_ADMIN"]);
  const canSeeTechnical = hasRole(ctx.roles, SCORING_ROLES);
  const reportable = isReportableStatus(match.status);
  const reports = reportable
    ? availableReports({
        matchId,
        discipline: match.discipline as Discipline,
        enabledReportTypes: ctx.tenant.config.enabledReportTypes,
        canSeeTechnical,
      })
    : [];
  const documents = reports.filter((r) => r.viewerVisible);
  const technical = reports.filter((r) => !r.viewerVisible);
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;

  return (
    <Page>
      <Link
        href={`${base}/schedule`}
        className="text-sm text-score-dim hover:text-foreground"
      >
        {t("match.backToSchedule")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {match.teamAName} vs {match.teamBName}
        </h1>
        <span className={statusBadgeClass(match.status)}>
          {matchStatusLabel(match.status, t("match.pendingBadge"))}
        </span>
      </div>
      <p className="mt-1 mb-6 text-sm text-score-dim">
        {competition.name} · {match.discipline}
        {match.roundName ? ` · ${match.roundName}` : ""}
      </p>

      <MatchTabs
        tenantSlug={tenantSlug}
        competitionId={competitionId}
        matchId={matchId}
        active="reports"
        canManage={canManage}
        showReports
      />

      <h2 className="text-lg font-medium">{t("reports.title")}</h2>
      <p className="mt-1 text-sm text-score-dim">{t("reports.subtitle")}</p>

      {isProvisional(match.status) && (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-400">
          {t("reports.notFinal")}
        </p>
      )}

      {!reportable ? (
        <div className={`${ui.card} mt-6 text-sm text-score-dim`}>
          {t("reports.notFinished")}
        </div>
      ) : reports.length === 0 ? (
        <div className={`${ui.card} mt-6 text-sm text-score-dim`}>
          {t("reports.none")}
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {documents.length > 0 && (
            <section aria-labelledby="reports-documents">
              <h3
                id="reports-documents"
                className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
              >
                {t("reports.matchDocuments")}
              </h3>
              <ul className="space-y-3">
                {documents.map((r) => (
                  <li key={r.type}>
                    <a
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${ui.card} flex items-center justify-between gap-4 transition-colors hover:border-primary`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-medium">
                          {t(REPORT_LABEL_KEY[r.type])}
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-score-dim">
                            {r.format}
                          </span>
                        </span>
                        {r.genericFallback && (
                          <span className="mt-1 block text-xs text-score-dim">
                            {t("reports.genericFallback")}
                          </span>
                        )}
                      </span>
                      <span className="flex-none text-sm text-score-dim">
                        {t("reports.download")} →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {technical.length > 0 && (
            <section aria-labelledby="reports-technical">
              <h3
                id="reports-technical"
                className="mb-1 text-xs font-medium uppercase tracking-wide text-score-dim"
              >
                {t("reports.technicalExports")}
              </h3>
              <p className="mb-3 text-xs text-score-dim">
                {t("reports.technicalHint")}
              </p>
              <ul className="space-y-3">
                {technical.map((r) => (
                  <li key={r.type}>
                    <a
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${ui.card} flex items-center justify-between gap-4 transition-colors hover:border-primary`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {t(REPORT_LABEL_KEY[r.type])}
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-score-dim">
                          {r.format}
                        </span>
                      </span>
                      <span className="flex-none text-sm text-score-dim">
                        {t("reports.download")} →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
