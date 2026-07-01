import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { listCompetitions } from "@/lib/competitions";
import { CompetitionFilters } from "@/components/admin/CompetitionFilters";
import { NewCompetitionForm } from "@/components/admin/NewCompetitionForm";
import { statusBadgeClass, ui } from "@/components/admin/styles";

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
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions`,
  );

  // Filters are applied in the WHERE clause, not in JS after fetching all rows.
  const competitions = await listCompetitions(ctx.tenant.id, {
    discipline,
    status,
    q,
  });

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
        <section className={competitions.length === 0 ? "order-last lg:order-none" : ""}>
          <CompetitionFilters discipline={discipline} status={status} q={q} />

          {competitions.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              {discipline || status || q
                ? "No competitions match these filters."
                : "No competitions yet. Create one to get started."}
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
