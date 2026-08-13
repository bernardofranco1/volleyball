import Link from "next/link";
import {
  ADMIN_ROLES,
  SCORING_ROLES,
  getAuthContext,
  getCurrentUser,
  hasRole,
} from "@/lib/authz";
import { getTenantBySlug } from "@/lib/tenant";
import { listAudit } from "@/lib/audit";
import { loadDashboard, type DashboardMatch } from "@/lib/dashboard";
import { matchBase, matchHref } from "@/lib/match-links";
import { getT } from "@/lib/i18n/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LocalTime } from "@/components/LocalTime";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Page, PageHeader, Panel, StatRow, StatTile } from "@/components/ui/Page";
import { matchStatusLabel, statusBadgeClass, ui } from "@/components/admin/styles";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The operational dashboard: live scores, today's throw times, what is waiting
 * on a decision, and the recent audit tail. It replaces three cards that
 * repeated the navigation menu.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { t } = await getT();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const [user, ctx] = await Promise.all([
    // getCurrentUser, not supabase.auth.getUser(): this must show the EFFECTIVE
    // user so "Signed in as" is honest while impersonating (spec/26 §10).
    getCurrentUser(),
    getAuthContext(tenantSlug),
  ]);
  const roles = ctx?.roles ?? [];
  const canManage = hasRole(roles, ADMIN_ROLES);
  const canScore = hasRole(roles, SCORING_ROLES);

  const [data, audit] = await Promise.all([
    loadDashboard(tenant.id, { includeAdmin: canManage }),
    canManage ? listAudit(tenant.id, 6) : Promise.resolve([]),
  ]);

  const nextUp = data.today.find((m) => m.scheduledAt);

  const columns: Column<DashboardMatch>[] = [
    {
      key: "time",
      header: t("common.time"),
      width: "w-16",
      cell: (m) => (
        <span className="font-mono text-xs tabular-nums text-score-dim">
          {m.scheduledAt ? <LocalTime date={m.scheduledAt} mode="time" /> : "—"}
        </span>
      ),
    },
    {
      key: "match",
      header: t("nav.matches"),
      cell: (m) => (
        <Link
          href={matchHref(tenantSlug, m, { manage: canManage, score: canScore })}
          className="block min-w-0"
        >
          <span className="font-medium">
            {m.teamAName} <span className="text-score-dim">–</span> {m.teamBName}
          </span>
          <span className="block truncate text-xs text-score-dim">
            {m.competitionName}
            {m.roundName ? ` · ${m.roundName}` : ""}
            {m.courtNumber
              ? ` · ${t("common.court")} ${m.courtNumber}`
              : ""}
          </span>
        </Link>
      ),
    },
    {
      key: "score",
      header: t("common.result"),
      align: "right",
      className: "font-mono tabular-nums",
      cell: (m) =>
        m.status === "LIVE" ? (
          <b>
            {m.setsWonA}–{m.setsWonB}
          </b>
        ) : (
          <span className="text-score-dim">—</span>
        ),
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
        <span className="flex justify-end gap-2 text-xs text-score-dim">
          {canManage && (
            <Link
              href={matchBase(tenantSlug, m)}
              className="hover:text-foreground"
            >
              {t("matches.manage")}
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

  return (
    <Page>
      <LiveRefresh active={data.live.length > 0} />
      <PageHeader
        title={t("dashboard.title")}
        meta={
          user?.email ? `${t("dashboard.signedInAs")} ${user.email}` : tenant.name
        }
        actions={
          canManage && (
            <Link href={`/t/${tenantSlug}/competitions`} className={ui.btnPrimary}>
              {t("comp.new")}
            </Link>
          )
        }
      />

      <StatRow>
        <StatTile
          label={t("matches.liveNow")}
          value={data.live.length}
          tone={data.live.length > 0 ? "success" : "default"}
          hint={data.live.map((m) => m.teamAName).join(" · ") || t("dashboard.noneLive")}
          href={`/t/${tenantSlug}/matches?status=live`}
        />
        <StatTile
          label={t("dashboard.today")}
          value={data.today.length}
          hint={
            nextUp
              ? `${nextUp.teamAName} – ${nextUp.teamBName}`
              : t("dashboard.nothingToday")
          }
          href={`/t/${tenantSlug}/matches?status=scheduled`}
        />
        <StatTile
          label={t("dashboard.pending")}
          value={data.pending.length}
          tone={data.pending.length > 0 ? "warning" : "default"}
          hint={
            data.pending[0]
              ? `${data.pending[0].teamAName} – ${data.pending[0].teamBName}`
              : t("dashboard.allConfirmed")
          }
          href={`/t/${tenantSlug}/matches?status=finished`}
        />
        <StatTile
          label={t("dashboard.season")}
          value={
            data.season ? (
              <>
                {data.season.played}
                <span className="text-sm font-normal text-score-dim">
                  {" / "}
                  {data.season.total}
                </span>
              </>
            ) : (
              "—"
            )
          }
          hint={data.season?.name ?? t("dashboard.noActiveCompetition")}
          href={
            data.season
              ? `/t/${tenantSlug}/competitions/${data.season.id}`
              : `/t/${tenantSlug}/competitions`
          }
        />
      </StatRow>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <DataTable
          columns={columns}
          rowKey={(m) => m.id}
          density="cozy"
          currentSort=""
          groups={[
            ...(data.live.length
              ? [
                  {
                    key: "live",
                    label: (
                      <span className="flex items-center gap-2 text-success">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                        {t("matches.liveNow")}
                      </span>
                    ),
                    rows: data.live,
                  },
                ]
              : []),
            ...(data.today.length
              ? [{ key: "today", label: t("dashboard.today"), rows: data.today }]
              : []),
          ]}
          empty={t("dashboard.nothingScheduled")}
          footer={
            <Link
              href={`/t/${tenantSlug}/matches`}
              className="hover:text-foreground"
            >
              {t("dashboard.allMatches")} →
            </Link>
          }
        />

        {canManage && (
          <div className="flex flex-col gap-4">
            <Panel title={t("dashboard.needsAttention")}>
              {data.pending.length === 0 && data.drafts.length === 0 ? (
                <p className="text-sm text-score-dim">{t("dashboard.allClear")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {data.pending.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={matchBase(tenantSlug, m)}
                        className="flex items-start gap-2 hover:text-foreground"
                      >
                        <span className={statusBadgeClass("PENDING_CONFIRMATION")}>
                          {t("match.pendingBadge")}
                        </span>
                        <span className="min-w-0">
                          {m.teamAName} – {m.teamBName}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {data.drafts.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/t/${tenantSlug}/competitions/${d.id}`}
                        className="flex items-start gap-2 hover:text-foreground"
                      >
                        <span className={statusBadgeClass("DRAFT")}>
                          {t("comp.draft")}
                        </span>
                        <span className="min-w-0">
                          {d.name}
                          {d.matchCount === 0 && (
                            <span className="text-score-dim">
                              {" "}
                              — {t("dashboard.noSchedule")}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={t("dashboard.recentActivity")}
              actions={
                <Link
                  href={`/t/${tenantSlug}/audit`}
                  className="text-xs text-score-dim hover:text-foreground"
                >
                  {t("nav.audit")} →
                </Link>
              }
            >
              {audit.length === 0 ? (
                <p className="text-sm text-score-dim">{t("audit.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-xs text-score-dim">
                  {audit.map((a) => (
                    <li key={a.id} className="flex gap-2">
                      <span className="flex-none font-mono tabular-nums">
                        <LocalTime date={a.createdAt} mode="time" />
                      </span>
                      <span className="min-w-0">
                        {a.summary ?? a.action}
                        {a.actorEmail && (
                          <span className="opacity-60"> · {a.actorEmail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </div>
    </Page>
  );
}
