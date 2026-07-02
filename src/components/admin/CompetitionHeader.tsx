import Link from "next/link";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
import { getT } from "@/lib/i18n/server";
import { statusBadgeClass } from "@/components/admin/styles";

/**
 * Shared header for every competition tab: breadcrumb, name + status badge,
 * discipline/gender line, and the public-surface links — so the sub-pages stop
 * drifting (previously only Overview had the badge and only Standings had the
 * public links).
 */
export async function CompetitionHeader({
  tenantSlug,
  competition,
  active,
  subtitle,
  actions,
}: {
  tenantSlug: string;
  competition: {
    id: string;
    name: string;
    status: string;
    discipline: string;
    gender: string | null;
  };
  active: "overview" | "teams" | "schedule" | "standings";
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = await getT();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/t/${tenantSlug}/competitions`}
            className="text-sm text-score-dim hover:text-foreground"
          >
            {t("comp.backToAll")}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {competition.name}
            </h1>
            <span className={statusBadgeClass(competition.status)}>
              {competition.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-score-dim">
            {competition.discipline}
            {competition.gender && competition.gender !== "UNSPECIFIED"
              ? ` · ${competition.gender}`
              : ""}
            {subtitle}
          </p>
          <p className="mt-1 text-xs text-score-dim">
            {t("comp.public")}{" "}
            <Link
              href={`/t/${tenantSlug}/results/${competition.id}`}
              className="underline hover:text-foreground"
            >
              {t("comp.resultsPage")}
            </Link>
            {" · "}
            <a
              href={`/api/competitions/${competition.id}/results.csv`}
              className="underline hover:text-foreground"
            >
              results.csv
            </a>
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      <CompetitionTabs
        tenantSlug={tenantSlug}
        competitionId={competition.id}
        active={active}
      />
    </>
  );
}
