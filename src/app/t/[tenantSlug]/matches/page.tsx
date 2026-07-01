import Link from "next/link";
import {
  ADMIN_ROLES,
  SCORING_ROLES,
  VIEW_ROLES,
  hasRole,
  requireRole,
} from "@/lib/authz";
import { listTenantMatches, type TenantMatchRow } from "@/lib/competitions";
import { DISCIPLINES } from "@/lib/domain";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LocalTime } from "@/components/LocalTime";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "finished", label: "Finished" },
] as const;

export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ discipline?: string; status?: string; order?: string }>;
}) {
  const { tenantSlug } = await params;
  const { discipline, status, order } = await searchParams;
  const ctx = await requireRole(
    tenantSlug,
    VIEW_ROLES,
    `/t/${tenantSlug}/matches`,
  );

  const statusFilter =
    status === "scheduled" || status === "live" || status === "finished"
      ? status
      : undefined;
  const orderDir = order === "desc" ? "desc" : "asc";

  const rows = await listTenantMatches(ctx.tenant.id, {
    discipline,
    status: statusFilter,
    order: orderDir,
  });

  // Live matches pin to a section on top (unless a status filter says otherwise).
  const liveRows = statusFilter ? [] : rows.filter((m) => m.status === "LIVE");
  const restRows = statusFilter
    ? rows
    : rows.filter((m) => m.status !== "LIVE");
  const anyLive = rows.some((m) => m.status === "LIVE");

  const canManage = hasRole(ctx.roles, ADMIN_ROLES);
  const canScore = hasRole(ctx.roles, SCORING_ROLES);

  // Primary card link routes by role: managers → match management, scorers →
  // the scoring interface, view-only → the public scoreboard.
  const matchHref = (m: TenantMatchRow) => {
    const detail = `/t/${tenantSlug}/competitions/${m.competitionId}/matches/${m.id}`;
    if (canManage) return detail;
    if (canScore) return `${detail}/live`;
    return `/t/${tenantSlug}/scoreboard/${m.id}`;
  };

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm";

  const MatchCard = ({ m }: { m: TenantMatchRow }) => {
    const detail = `/t/${tenantSlug}/competitions/${m.competitionId}/matches/${m.id}`;
    return (
      <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 transition-colors hover:border-primary">
        <Link href={matchHref(m)} className="block">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-score-dim">
            <span className="font-mono tabular-nums">
              {m.scheduledAt ? <LocalTime date={m.scheduledAt} /> : "—"}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{m.competitionName}</span>
            <span aria-hidden>·</span>
            <span>{m.discipline}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium">
              {m.teamAName} <span className="text-score-dim">vs</span>{" "}
              {m.teamBName}
            </span>
            <span className="flex flex-none items-center gap-2">
              {m.status === "LIVE" || m.status === "FINISHED" ? (
                <span className="font-mono text-sm tabular-nums text-score-dim">
                  {m.setsWonA}–{m.setsWonB}
                </span>
              ) : null}
              <span className={statusBadgeClass(m.status)}>{m.status}</span>
            </span>
          </div>
        </Link>
        {/* Explicit destinations — the card's own link varies by role, which
            is invisible; these make Manage / Score / Board reachable. */}
        {(canManage || canScore) && (
          <div className="mt-1.5 flex gap-3 text-xs text-score-dim">
            {canManage && (
              <Link href={detail} className="hover:text-foreground">
                Manage
              </Link>
            )}
            {canScore && (
              <Link href={`${detail}/live`} className="hover:text-foreground">
                Score
              </Link>
            )}
            <Link
              href={`/t/${tenantSlug}/scoreboard/${m.id}`}
              className="hover:text-foreground"
            >
              Board
            </Link>
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      {/* Re-render the list every 20s while a match is live. */}
      <LiveRefresh active={anyLive} />

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Match schedule
          </h1>
          <p className="mt-1 text-sm text-score-dim">
            All matches across {ctx.tenant.name}&apos;s competitions.
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/dashboard`} className={ui.btnSecondary}>
          ← Dashboard
        </Link>
      </div>

      {/* Filters (GET form → URL params, server-rendered). */}
      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-score-dim">
          Discipline
          <select name="discipline" defaultValue={discipline ?? ""} className={selectCls}>
            <option value="">All</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-score-dim">
          Status
          <select name="status" defaultValue={statusFilter ?? ""} className={selectCls}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-score-dim">
          Order by date
          <select name="order" defaultValue={orderDir} className={selectCls}>
            <option value="asc">Earliest first</option>
            <option value="desc">Latest first</option>
          </select>
        </label>
        <button type="submit" className={ui.btnSecondary}>
          Apply
        </button>
        {(discipline || statusFilter || order) && (
          <Link
            href={`/t/${tenantSlug}/matches`}
            className="px-2 py-1.5 text-sm text-score-dim hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      {liveRows.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
            Live now
          </h2>
          <ul className="space-y-2">
            {liveRows.map((m) => (
              <li key={m.id}>
                <MatchCard m={m} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mb-2 text-xs text-score-dim">
        {rows.length} match{rows.length === 1 ? "" : "es"}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center text-sm text-score-dim">
          <p>No matches found.</p>
          <p className="mt-2">
            {discipline || statusFilter ? (
              <Link
                href={`/t/${tenantSlug}/matches`}
                className="underline hover:text-foreground"
              >
                Clear filters
              </Link>
            ) : canManage ? (
              <Link
                href={`/t/${tenantSlug}/competitions`}
                className="underline hover:text-foreground"
              >
                Create matches from a competition&apos;s Schedule tab →
              </Link>
            ) : (
              "Check back once the schedule is published."
            )}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {restRows.map((m) => (
            <li key={m.id}>
              <MatchCard m={m} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
