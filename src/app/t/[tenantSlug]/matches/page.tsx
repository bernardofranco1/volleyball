import Link from "next/link";
import {
  ADMIN_ROLES,
  SCORING_ROLES,
  VIEW_ROLES,
  hasRole,
  requireRole,
} from "@/lib/authz";
import { listTenantMatches } from "@/lib/competitions";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const DISCIPLINES = ["BEACH", "INDOOR", "GRASS", "LIGHT"] as const;
const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "finished", label: "Finished" },
] as const;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  // Stored zone-less = UTC (spec/14 §E2); show consistently in UTC.
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

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

  // Match cards route by role: managers → match management, scorers → the
  // scoring interface, view-only → the public scoreboard (all read/act surfaces
  // they're actually allowed to open).
  const canManage = hasRole(ctx.roles, ADMIN_ROLES);
  const canScore = hasRole(ctx.roles, SCORING_ROLES);
  const matchHref = (m: (typeof rows)[number]) => {
    const detail = `/t/${tenantSlug}/competitions/${m.competitionId}/matches/${m.id}`;
    if (canManage) return detail;
    if (canScore) return `${detail}/live`;
    return `/t/${tenantSlug}/scoreboard/${m.id}`;
  };

  const selectCls =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
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

      <p className="mb-2 text-xs text-score-dim">
        {rows.length} match{rows.length === 1 ? "" : "es"}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center text-score-dim">
          No matches found.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li key={m.id}>
              {/* Whole card is the link to the match page (mobile + web). */}
              <Link
                href={matchHref(m)}
                className="block rounded-xl border border-border bg-surface-raised px-4 py-3 transition-colors hover:border-primary"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-score-dim">
                  <span className="font-mono tabular-nums">
                    {fmtDate(m.scheduledAt)}
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
