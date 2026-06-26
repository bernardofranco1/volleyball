import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { listCompetitions } from "@/lib/competitions";
import { NewCompetitionForm } from "@/components/admin/NewCompetitionForm";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const DISCIPLINES = ["BEACH", "INDOOR", "GRASS", "LIGHT"] as const;
const STATUSES = ["DRAFT", "ACTIVE", "FINISHED"] as const;

export default async function CompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ discipline?: string; status?: string }>;
}) {
  const { tenantSlug } = await params;
  const { discipline, status } = await searchParams;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions`,
  );

  let competitions = await listCompetitions(ctx.tenant.id);
  if (discipline) competitions = competitions.filter((c) => c.discipline === discipline);
  if (status) competitions = competitions.filter((c) => c.status === status);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Competitions</h1>
          <p className="mt-1 text-sm text-score-dim">
            Create and manage competitions for {ctx.tenant.name}.
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/dashboard`} className={ui.btnSecondary}>
          ← Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* List + filters */}
        <section>
          <form
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3"
          >
            <div>
              <label className={ui.label} htmlFor="f-discipline">
                Discipline
              </label>
              <select
                id="f-discipline"
                name="discipline"
                defaultValue={discipline ?? ""}
                className={ui.select}
              >
                <option value="">All</option>
                {DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ui.label} htmlFor="f-status">
                Status
              </label>
              <select
                id="f-status"
                name="status"
                defaultValue={status ?? ""}
                className={ui.select}
              >
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={ui.btnSecondary}>
              Filter
            </button>
          </form>

          {competitions.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              No competitions yet. Create one to get started.
            </div>
          ) : (
            <ul className="space-y-3">
              {competitions.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/t/${tenantSlug}/competitions/${c.id}`}
                    className={`${ui.card} flex items-center justify-between gap-4 transition-colors hover:border-primary`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <span className={statusBadgeClass(c.status)}>
                          {c.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-score-dim">
                        {c.discipline}
                        {c.gender && c.gender !== "UNSPECIFIED"
                          ? ` · ${c.gender}`
                          : ""}
                        {c.venue ? ` · ${c.venue}` : ""}
                        {c.startDate ? ` · ${c.startDate}` : ""}
                      </p>
                    </div>
                    <span className="text-score-dim">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <NewCompetitionForm tenantSlug={tenantSlug} />
        </aside>
      </div>
    </main>
  );
}
