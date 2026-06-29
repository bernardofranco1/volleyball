import Link from "next/link";
import { SCORING_ROLES, requireRole } from "@/lib/authz";
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
    SCORING_ROLES,
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
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-score-dim">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Competition</th>
                <th className="px-4 py-2 font-medium">Discipline</th>
                <th className="px-4 py-2 font-medium">Match</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Sets</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">
                    {fmtDate(m.scheduledAt)}
                  </td>
                  <td className="px-4 py-2">{m.competitionName}</td>
                  <td className="px-4 py-2 text-score-dim">{m.discipline}</td>
                  <td className="px-4 py-2">
                    {m.teamAName} <span className="text-score-dim">vs</span>{" "}
                    {m.teamBName}
                  </td>
                  <td className="px-4 py-2">
                    <span className={statusBadgeClass(m.status)}>{m.status}</span>
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums">
                    {m.status === "LIVE" || m.status === "FINISHED"
                      ? `${m.setsWonA}–${m.setsWonB}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/t/${tenantSlug}/competitions/${m.competitionId}/matches/${m.id}`}
                      className="text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
