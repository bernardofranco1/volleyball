import Link from "next/link";
import {
  ADMIN_ROLES,
  SCORING_ROLES,
  VIEW_ROLES,
  hasRole,
  requireRole,
} from "@/lib/authz";
import {
  disciplineFilterOptions,
  listCompetitions,
  listTenantMatches,
  loadSetScores,
  matchStatusCounts,
  MATCHES_PAGE_SIZE,
  type MatchStatusFilter,
  type TenantMatchRow,
} from "@/lib/competitions";
import { matchBase, matchHref } from "@/lib/match-links";
import { readableTextOn } from "@/lib/colors";
import { DISCIPLINES } from "@/lib/domain";
import { getT } from "@/lib/i18n/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LocalTime } from "@/components/LocalTime";
import { DataTable, type Column, type RowGroup } from "@/components/ui/DataTable";
import { Page, PageHeader } from "@/components/ui/Page";
import { FilterChip, SearchBox, Toolbar, ToolbarSpacer } from "@/components/ui/Toolbar";
import { SelectAll } from "@/components/ui/SelectAll";
import { SelectNav } from "@/components/ui/SelectNav";
import { matchStatusLabel, statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

/** Ties the toolbar's export button to the form that wraps the table. */
const EXPORT_FORM_ID = "match-export";

const STATUS_CHIPS: { value: MatchStatusFilter; labelKey: string; dot?: boolean }[] = [
  { value: "live", labelKey: "matches.live", dot: true },
  { value: "scheduled", labelKey: "matches.scheduled" },
  { value: "pending", labelKey: "match.pendingBadge" },
  { value: "finished", labelKey: "matches.finished" },
];

/** Day bucket for the group headers, in UTC (see LocalTime for the caveat). */
function dayKey(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "unscheduled";
}

export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    discipline?: string;
    competition?: string;
    q?: string;
    status?: string;
    order?: string;
    page?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const sp = await searchParams;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    VIEW_ROLES,
    `/t/${tenantSlug}/matches`,
  );

  const statusFilter = (
    ["scheduled", "live", "pending", "finished"] as MatchStatusFilter[]
  ).includes(sp.status as MatchStatusFilter)
    ? (sp.status as MatchStatusFilter)
    : undefined;
  const orderDir = sp.order === "desc" ? "desc" : "asc";
  const q = sp.q?.trim() || undefined;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  const filters = {
    discipline: sp.discipline,
    competitionId: sp.competition,
    q,
  };

  const [{ rows, hasMore }, counts, disciplineOptions, comps] = await Promise.all([
    listTenantMatches(ctx.tenant.id, {
      ...filters,
      status: statusFilter,
      order: orderDir,
      page,
    }),
    matchStatusCounts(ctx.tenant.id, filters),
    disciplineFilterOptions(ctx.tenant.id, ctx.tenant.config.enabledDisciplines),
    listCompetitions(ctx.tenant.id),
  ]);
  // Only the rows with a result need their per-set detail fetched.
  const setScores = await loadSetScores(
    rows.filter((m) => m.setsWonA + m.setsWonB > 0).map((m) => m.id),
  );

  const canManage = hasRole(ctx.roles, ADMIN_ROLES);
  const canScore = hasRole(ctx.roles, SCORING_ROLES);
  const anyLive = rows.some((m) => m.status === "LIVE");

  /** A URL with one parameter changed and the page reset. */
  const withParam = (
    changes: Record<string, string | undefined>,
  ): string => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      discipline: sp.discipline,
      competition: sp.competition,
      q,
      status: statusFilter,
      order: sp.order,
      ...changes,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `?${s}` : `/t/${tenantSlug}/matches`;
  };

  const pageHref = (p: number) => {
    const base = withParam({});
    const sep = base.includes("?") ? "&" : "?";
    return p === 0 ? base : `${base}${sep}page=${p}`;
  };

  // Live matches pin to their own group on top; the rest group by calendar day.
  // With an explicit status filter the pinning is redundant (and confusing when
  // the filter IS "live"), so the day grouping stands alone.
  const live = statusFilter ? [] : rows.filter((m) => m.status === "LIVE");
  const rest = statusFilter ? rows : rows.filter((m) => m.status !== "LIVE");
  const byDay = new Map<string, TenantMatchRow[]>();
  for (const m of rest) {
    const k = dayKey(m.scheduledAt);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }

  const groups: RowGroup<TenantMatchRow>[] = [
    ...(live.length
      ? [
          {
            key: "live",
            label: (
              <span className="flex items-center gap-2 text-success">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                {t("matches.liveNow")}
              </span>
            ),
            rows: live,
          },
        ]
      : []),
    ...[...byDay.entries()].map(([k, ms]) => ({
      key: k,
      label:
        k === "unscheduled" ? (
          t("matches.unscheduled")
        ) : (
          <LocalTime date={new Date(`${k}T12:00:00Z`)} mode="date" />
        ),
      rows: ms,
    })),
  ];

  const columns: Column<TenantMatchRow>[] = [
    {
      key: "select",
      header: <SelectAll label={t("matches.selectAll")} />,
      width: "w-9",
      cell: (m) => (
        <input
          type="checkbox"
          name="id"
          value={m.id}
          aria-label={`${m.teamAName} – ${m.teamBName}`}
          className="accent-primary"
        />
      ),
    },
    {
      key: "time",
      header: t("common.time"),
      width: "w-20",
      className: "font-mono tabular-nums",
      cell: (m) => (
        <span className="whitespace-nowrap text-xs text-score-dim">
          {m.scheduledAt ? <LocalTime date={m.scheduledAt} mode="time" /> : "—"}
        </span>
      ),
    },
    {
      key: "match",
      header: t("matches.thMatch"),
      cell: (m) => (
        <Link
          href={matchHref(tenantSlug, m, { manage: canManage, score: canScore })}
          className="block min-w-0"
        >
          <span className="font-medium">
            {m.teamAName} <span className="text-score-dim">–</span> {m.teamBName}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-score-dim">
            {m.competitionColor ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: m.competitionColor,
                  color: readableTextOn(m.competitionColor),
                }}
              >
                {m.competitionName}
              </span>
            ) : (
              <span>{m.competitionName}</span>
            )}
            <span>· {m.discipline}</span>
          </span>
        </Link>
      ),
    },
    {
      key: "round",
      header: t("common.round"),
      width: "w-24",
      className: "max-lg:hidden",
      cell: (m) => (
        <span className="text-xs text-score-dim">{m.roundName ?? "—"}</span>
      ),
    },
    {
      key: "court",
      header: t("common.court"),
      width: "w-12",
      align: "center",
      className: "max-md:hidden font-mono tabular-nums text-xs",
      cell: (m) => m.courtNumber ?? "—",
    },
    {
      key: "result",
      header: t("common.result"),
      className: "font-mono tabular-nums",
      cell: (m) => {
        const sets = setScores.get(m.id);
        if (!sets || sets.length === 0)
          return <span className="text-score-dim">—</span>;
        return (
          <span className="whitespace-nowrap">
            <b>
              {m.setsWonA}–{m.setsWonB}
            </b>
            <span className="ml-2 text-xs text-score-dim max-xl:hidden">
              {sets.map((s) => `${s.a}-${s.b}`).join(" · ")}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: t("common.status"),
      width: "w-24",
      cell: (m) => (
        <span className={statusBadgeClass(m.status)}>
          {matchStatusLabel(m.status, t("match.pendingBadge"))}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (m) => (
        <span className="flex justify-end gap-2 whitespace-nowrap text-xs text-score-dim">
          {canManage && (
            <Link href={matchBase(tenantSlug, m)} className="hover:text-foreground">
              {t("matches.manage")}
            </Link>
          )}
          {canScore && m.status !== "FINISHED" && (
            <Link
              href={`${matchBase(tenantSlug, m)}/live`}
              className="hover:text-foreground"
            >
              {t("matches.score")}
            </Link>
          )}
          <Link
            href={`/t/${tenantSlug}/scoreboard/${m.id}`}
            className="hover:text-foreground"
          >
            {t("matches.board")}
          </Link>
        </span>
      ),
    },
  ];

  const selectCls =
    "rounded-full border border-border bg-surface px-3 py-1 text-xs text-score-dim";

  return (
    <Page>
      {/* Re-render the list every 20s while a match is live. */}
      <LiveRefresh active={anyLive} />

      <PageHeader
        title={t("matches.title")}
        meta={t("matches.subtitle", { tenant: ctx.tenant.name })}
      />

      {/*
        Bulk selection is plain HTML: the row checkboxes are `id` inputs in a
        GET form pointed at the CSV route, so selecting and exporting needs no
        client state. The form wraps only the table — the search box is itself a
        form and forms cannot nest — and the toolbar's export button reaches it
        by id. Filters stay links: instant, and each filtered view has a URL.
      */}
      <div className="mb-3 flex flex-col gap-2">
          <Toolbar>
            <SearchBox
              defaultValue={sp.q}
              placeholder={t("matches.searchPlaceholder")}
              carry={{
                discipline: sp.discipline,
                competition: sp.competition,
                status: statusFilter,
                order: sp.order,
              }}
            />
            <FilterChip
              href={withParam({ status: undefined })}
              active={!statusFilter}
              label={t("common.all")}
              count={counts.all}
            />
            {STATUS_CHIPS.map((c) => (
              <FilterChip
                key={c.value}
                href={withParam({ status: c.value })}
                active={statusFilter === c.value}
                label={t(c.labelKey)}
                count={counts[c.value]}
                dot={c.dot && counts.live > 0}
              />
            ))}
            <ToolbarSpacer />
            {/* Competition and discipline stay as selects: a chip each would be
                one row per competition once a tenant runs a few seasons. They
                still filter on change, like the chips do. */}
            <SelectNav
              value={sp.competition ?? ""}
              label={t("nav.competitions")}
              className={selectCls}
              options={[
                { value: "", label: t("matches.allCompetitions") },
                ...comps.map((c) => ({ value: c.id, label: c.name })),
              ]}
              hrefFor={Object.fromEntries([
                ["", withParam({ competition: undefined })],
                ...comps.map((c) => [c.id, withParam({ competition: c.id })]),
              ])}
            />
            <SelectNav
              value={sp.discipline ?? ""}
              label={t("common.discipline")}
              className={selectCls}
              options={[
                { value: "", label: t("common.all") },
                ...DISCIPLINES.filter((d) => disciplineOptions.includes(d)).map(
                  (d) => ({ value: d, label: d }),
                ),
              ]}
              hrefFor={Object.fromEntries([
                ["", withParam({ discipline: undefined })],
                ...DISCIPLINES.filter((d) => disciplineOptions.includes(d)).map(
                  (d) => [d, withParam({ discipline: d })],
                ),
              ])}
            />
            <Link
              href={withParam({ order: orderDir === "asc" ? "desc" : "asc" })}
              className="rounded-full border border-border px-3 py-1 text-xs text-score-dim transition-colors hover:text-foreground"
            >
              {orderDir === "asc" ? t("matches.earliest") : t("matches.latest")}
            </Link>
            <button
              type="submit"
              form={EXPORT_FORM_ID}
              className={ui.btnSecondary}
            >
              {t("matches.exportCsv")}
            </button>
          </Toolbar>
      </div>

      <form id={EXPORT_FORM_ID} method="get" action="/api/matches/export.csv">
        <input type="hidden" name="tenant" value={tenantSlug} />
        {sp.discipline && (
          <input type="hidden" name="discipline" value={sp.discipline} />
        )}
        {sp.competition && (
          <input type="hidden" name="competition" value={sp.competition} />
        )}
        {q && <input type="hidden" name="q" value={q} />}
        {statusFilter && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <input type="hidden" name="order" value={orderDir} />

        <DataTable
          columns={columns}
          groups={groups}
          rowKey={(m) => m.id}
          density="compact"
          empty={
            <>
              <p>{t("matches.empty")}</p>
              <p className="mt-2">
                {q || statusFilter || sp.discipline || sp.competition ? (
                  <Link
                    href={`/t/${tenantSlug}/matches`}
                    className="underline hover:text-foreground"
                  >
                    {t("matches.clearFilters")}
                  </Link>
                ) : canManage ? (
                  <Link
                    href={`/t/${tenantSlug}/competitions`}
                    className="underline hover:text-foreground"
                  >
                    {t("matches.createFrom")}
                  </Link>
                ) : (
                  t("matches.checkBack")
                )}
              </p>
            </>
          }
          footer={
            <div className="flex items-center justify-between gap-3">
              <span>
                {t("matches.showing", {
                  from: rows.length === 0 ? 0 : page * MATCHES_PAGE_SIZE + 1,
                  to: page * MATCHES_PAGE_SIZE + rows.length,
                  total: counts.all,
                })}
              </span>
              <span className="flex items-center gap-1">
                {page > 0 && (
                  <Link href={pageHref(page - 1)} className="px-2 hover:text-foreground">
                    ←
                  </Link>
                )}
                {/* Real page numbers: "Previous / Next" gave no sense of how
                    much schedule there is, and no way to jump. */}
                {Array.from(
                  { length: Math.max(1, Math.ceil(counts.all / MATCHES_PAGE_SIZE)) },
                  (_, i) => i,
                )
                  .slice(Math.max(0, page - 3), Math.max(0, page - 3) + 7)
                  .map((p) => (
                    <Link
                      key={p}
                      href={pageHref(p)}
                      aria-current={p === page ? "page" : undefined}
                      className={`rounded px-2 py-0.5 tabular-nums ${
                        p === page
                          ? "bg-surface-selected text-foreground"
                          : "hover:text-foreground"
                      }`}
                    >
                      {p + 1}
                    </Link>
                  ))}
                {hasMore && (
                  <Link href={pageHref(page + 1)} className="px-2 hover:text-foreground">
                    →
                  </Link>
                )}
              </span>
            </div>
          }
        />
      </form>
    </Page>
  );
}
