import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  disciplineFilterOptions,
  listCompetitions,
  type Competition,
} from "@/lib/competitions";
import { getT } from "@/lib/i18n/server";
import { CompetitionFilters } from "@/components/admin/CompetitionFilters";
import { NewCompetitionForm } from "@/components/admin/NewCompetitionForm";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Page, PageHeader } from "@/components/ui/Page";
import { statusBadgeClass } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ discipline?: string; status?: string; q?: string }>;
}) {
  const { tenantSlug } = await params;
  const { discipline, status, q } = await searchParams;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions`,
  );

  // Filters are applied in the WHERE clause, not in JS after fetching all rows.
  const [competitions, disciplineOptions] = await Promise.all([
    listCompetitions(ctx.tenant.id, { discipline, status, q }),
    disciplineFilterOptions(ctx.tenant.id, ctx.tenant.config.enabledDisciplines),
  ]);

  const columns: Column<Competition>[] = [
    {
      key: "name",
      header: t("comp.title"),
      cell: (c) => (
        <Link
          href={`/t/${tenantSlug}/competitions/${c.id}`}
          className="flex items-center gap-2 font-medium"
        >
          {c.color && (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 flex-none rounded-full"
              style={{ backgroundColor: c.color }}
            />
          )}
          {c.name}
        </Link>
      ),
    },
    {
      key: "discipline",
      header: t("common.discipline"),
      width: "w-24",
      cell: (c) => <span className="text-xs text-score-dim">{c.discipline}</span>,
    },
    {
      key: "gender",
      header: t("comp.gender"),
      width: "w-24",
      className: "max-md:hidden",
      cell: (c) => (
        <span className="text-xs text-score-dim">
          {c.gender && c.gender !== "UNSPECIFIED" ? c.gender : "—"}
        </span>
      ),
    },
    {
      key: "venue",
      header: t("comp.venue"),
      className: "max-lg:hidden",
      cell: (c) => (
        <span className="text-xs text-score-dim">
          {[c.venue, c.city].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "dates",
      header: t("comp.dates"),
      width: "w-44",
      className: "max-lg:hidden font-mono tabular-nums text-xs",
      cell: (c) =>
        c.startDate ? (
          <span className="text-score-dim">
            {c.startDate}
            {c.endDate ? ` → ${c.endDate}` : ""}
          </span>
        ) : (
          <span className="text-score-dim">—</span>
        ),
    },
    {
      key: "status",
      header: t("common.status"),
      width: "w-24",
      cell: (c) => (
        <span className={statusBadgeClass(c.status)}>{c.status}</span>
      ),
    },
    {
      key: "go",
      header: "",
      align: "right",
      width: "w-24",
      cell: (c) => (
        <span className="flex justify-end gap-2 text-xs text-score-dim">
          <Link
            href={`/t/${tenantSlug}/competitions/${c.id}/schedule`}
            className="hover:text-foreground"
          >
            {t("tabs.schedule")}
          </Link>
          <Link
            href={`/t/${tenantSlug}/competitions/${c.id}/standings`}
            className="hover:text-foreground"
          >
            {t("tabs.standings")}
          </Link>
        </span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t("comp.title")}
        meta={t("comp.subtitle", { tenant: ctx.tenant.name })}
        actions={
          // The create form was a permanent 360px rail next to a list that is
          // the actual job of this page.
          <Drawer label={t("comp.new")} variant="primary" width="lg">
            <NewCompetitionForm
              tenantSlug={tenantSlug}
              enabledDisciplines={ctx.tenant.config.enabledDisciplines}
            />
          </Drawer>
        }
      />

      <div className="mb-3">
        <CompetitionFilters
          discipline={discipline}
          status={status}
          q={q}
          disciplineOptions={disciplineOptions}
        />
      </div>

      <DataTable
        columns={columns}
        rowKey={(c) => c.id}
        density="cozy"
        groups={[{ key: "all", rows: competitions }]}
        empty={
          discipline || status || q ? t("comp.emptyFiltered") : t("comp.empty")
        }
      />
    </Page>
  );
}
