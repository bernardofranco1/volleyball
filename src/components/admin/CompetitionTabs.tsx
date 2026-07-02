import Link from "next/link";
import { getT } from "@/lib/i18n/server";

type Tab = "overview" | "teams" | "schedule" | "standings";

const TABS: { key: Tab; labelKey: string; path: string }[] = [
  { key: "overview", labelKey: "tabs.overview", path: "" },
  { key: "teams", labelKey: "tabs.teams", path: "/teams" },
  { key: "schedule", labelKey: "tabs.schedule", path: "/schedule" },
  { key: "standings", labelKey: "tabs.standings", path: "/standings" },
];

export async function CompetitionTabs({
  tenantSlug,
  competitionId,
  active,
}: {
  tenantSlug: string;
  competitionId: string;
  active: Tab;
}) {
  const { t } = await getT();
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;
  return (
    <nav className="mb-6 flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${base}${tab.path}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-score-dim hover:text-foreground"
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
