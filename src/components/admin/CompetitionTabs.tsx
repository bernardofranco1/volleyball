import Link from "next/link";

type Tab = "overview" | "teams" | "schedule" | "standings";

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "teams", label: "Teams", path: "/teams" },
  { key: "schedule", label: "Schedule", path: "/schedule" },
  { key: "standings", label: "Standings", path: "/standings" },
];

export function CompetitionTabs({
  tenantSlug,
  competitionId,
  active,
}: {
  tenantSlug: string;
  competitionId: string;
  active: Tab;
}) {
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;
  return (
    <nav className="mb-6 flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${base}${t.path}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-score-dim hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
