import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export type MatchTab = "overview" | "reports";

/**
 * Tabs on a match page (spec/24 §3.1). Overview and Reports are separate routes
 * rather than one page with a query param precisely so they can carry different
 * authorization: Overview is the admin hub (ADMIN_ROLES), Reports is readable by
 * anyone with access to the tenant.
 *
 * `canManage` therefore hides the Overview tab from viewers — linking them to a
 * page that answers notFound() is worse than not offering it. When only one tab
 * is available the bar is not rendered at all.
 */
export async function MatchTabs({
  tenantSlug,
  competitionId,
  matchId,
  active,
  canManage,
  showReports,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  active: MatchTab;
  canManage: boolean;
  showReports: boolean;
}) {
  const { t } = await getT();
  const base = `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`;
  const tabs = [
    ...(canManage
      ? [{ key: "overview" as const, label: t("tabs.overview"), href: base }]
      : []),
    ...(showReports
      ? [
          {
            key: "reports" as const,
            label: t("tabs.reports"),
            href: `${base}/reports`,
          },
        ]
      : []),
  ];
  if (tabs.length < 2) return null;

  return (
    <nav className="mb-6 flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-score-dim hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
