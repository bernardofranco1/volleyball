import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { auditActions, AUDIT_PAGE_SIZE, listAuditPage, type AuditRow } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";
import { LocalTime } from "@/components/LocalTime";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Page, PageHeader } from "@/components/ui/Page";
import { FilterChip, SearchBox, Toolbar, ToolbarSpacer } from "@/components/ui/Toolbar";
import { SelectNav } from "@/components/ui/SelectNav";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ q?: string; action?: string; page?: string }>;
}) {
  const { tenantSlug } = await params;
  const sp = await searchParams;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    ["TENANT_ADMIN"],
    `/t/${tenantSlug}/audit`,
  );

  const q = sp.q?.trim() || undefined;
  const action = sp.action || undefined;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  const [{ rows, hasMore, total }, actions] = await Promise.all([
    listAuditPage(ctx.tenant.id, { q, action, page }),
    auditActions(ctx.tenant.id),
  ]);

  const hrefFor = (changes: { action?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const a = "action" in changes ? changes.action : action;
    if (a) p.set("action", a);
    if (changes.page) p.set("page", String(changes.page));
    const s = p.toString();
    return `/t/${tenantSlug}/audit${s ? `?${s}` : ""}`;
  };

  const exportHref = `/api/audit/export.csv?${new URLSearchParams({
    tenant: tenantSlug,
    ...(q ? { q } : {}),
    ...(action ? { action } : {}),
  }).toString()}`;

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: t("audit.when"),
      width: "w-40",
      className: "font-mono tabular-nums text-xs",
      cell: (r) => (
        <span className="whitespace-nowrap text-score-dim">
          <LocalTime date={r.createdAt} />
        </span>
      ),
    },
    {
      key: "actor",
      header: t("match.thActor"),
      width: "w-56",
      cell: (r) => (
        <span className="text-xs text-score-dim">
          {r.actorEmail ?? r.actorUserId?.slice(0, 8) ?? "—"}
        </span>
      ),
    },
    {
      key: "action",
      header: t("audit.action"),
      width: "w-56",
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
    },
    {
      key: "detail",
      header: t("audit.detail"),
      cell: (r) => <span className="text-sm">{r.summary ?? "—"}</span>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={t("audit.title")}
        meta={t("audit.subtitle", { tenant: ctx.tenant.name })}
        actions={
          <a href={exportHref} className={ui.btnSecondary}>
            {t("matches.exportCsv")}
          </a>
        }
      />

      <div className="mb-3">
        <Toolbar>
          <SearchBox
            defaultValue={sp.q}
            placeholder={t("audit.searchPlaceholder")}
            carry={{ action }}
          />
          <FilterChip
            href={hrefFor({ action: undefined })}
            active={!action}
            label={t("common.all")}
            count={total}
          />
          <ToolbarSpacer />
          {/* One chip per action would be twenty-plus chips on a busy tenant. */}
          <SelectNav
            value={action ?? ""}
            label={t("audit.action")}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-score-dim"
            options={[
              { value: "", label: t("audit.allActions") },
              ...actions.map((a) => ({ value: a, label: a })),
            ]}
            hrefFor={Object.fromEntries([
              ["", hrefFor({ action: undefined })],
              ...actions.map((a) => [a, hrefFor({ action: a })]),
            ])}
          />
        </Toolbar>
      </div>

      <DataTable
        columns={columns}
        rowKey={(r) => r.id}
        density="compact"
        groups={[{ key: "all", rows }]}
        empty={t("audit.empty")}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span>
              {t("matches.showing", {
                from: rows.length === 0 ? 0 : page * AUDIT_PAGE_SIZE + 1,
                to: page * AUDIT_PAGE_SIZE + rows.length,
                total,
              })}
            </span>
            <span className="flex items-center gap-1">
              {page > 0 && (
                <Link
                  href={hrefFor({ page: page - 1 })}
                  className="px-2 hover:text-foreground"
                >
                  ←
                </Link>
              )}
              {Array.from(
                { length: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) },
                (_, i) => i,
              )
                .slice(Math.max(0, page - 3), Math.max(0, page - 3) + 7)
                .map((p) => (
                  <Link
                    key={p}
                    href={hrefFor({ page: p })}
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
                <Link
                  href={hrefFor({ page: page + 1 })}
                  className="px-2 hover:text-foreground"
                >
                  →
                </Link>
              )}
            </span>
          </div>
        }
      />
    </Page>
  );
}
