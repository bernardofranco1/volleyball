// People directory (spec/24 §6.1): the tenant-level registry of players,
// referees, coaches and scorers. Before this, a player existed only inside one
// team in one competition and an official was a name retyped per match, so there
// was nowhere to look someone up or correct them once.
import Link from "next/link";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  countPeopleByRole,
  isPersonRole,
  listPeople,
  personName,
  PEOPLE_PAGE_SIZE,
  PERSON_ROLES,
  type PersonRole,
} from "@/lib/people";
import { NewPersonForm } from "@/components/admin/PersonForm";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<PersonRole, string> = {
  PLAYER: "Players",
  REFEREE: "Referees",
  COACH: "Coaches",
  SCORER: "Scorers",
};

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  const { tenantSlug } = await params;
  const { q, role: roleParam, page: pageParam } = await searchParams;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/people`,
  );

  const role =
    roleParam && isPersonRole(roleParam) ? (roleParam as PersonRole) : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const [{ rows, hasMore }, counts] = await Promise.all([
    listPeople(ctx.tenant.id, { q, role, page }),
    countPeopleByRole(ctx.tenant.id),
  ]);

  const chipHref = (r?: PersonRole) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (r) p.set("role", r);
    const s = p.toString();
    return `/t/${tenantSlug}/people${s ? `?${s}` : ""}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (role) p.set("role", role);
    if (n > 0) p.set("page", String(n));
    const s = p.toString();
    return `/t/${tenantSlug}/people${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-score-dim">
            Players, referees, coaches and scorers for {ctx.tenant.name}. Rosters
            and match officials reference these records, so a correction here
            reaches every competition.
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/dashboard`} className={ui.btnSecondary}>
          ← Home
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <section>
          {/* Search + role filter. GET form → URL params, server-rendered. */}
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs text-score-dim">
              Search
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Name…"
                className={ui.input}
              />
            </label>
            {role && <input type="hidden" name="role" value={role} />}
            <button type="submit" className={ui.btnSecondary}>
              Search
            </button>
          </form>

          <div className="mb-4 flex flex-wrap gap-2">
            <Link
              href={chipHref()}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                role
                  ? "border-border text-score-dim hover:text-foreground"
                  : "border-primary text-foreground"
              }`}
            >
              All
            </Link>
            {PERSON_ROLES.map((r) => (
              <Link
                key={r}
                href={chipHref(r)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  role === r
                    ? "border-primary text-foreground"
                    : "border-border text-score-dim hover:text-foreground"
                }`}
              >
                {ROLE_LABEL[r]} ({counts[r]})
              </Link>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              {q || role
                ? "Nobody matches that filter."
                : "No people yet. Add someone, or import a roster from the Teams tab of a competition — imported names are matched to existing people and created when new."}
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/t/${tenantSlug}/people/${p.id}`}
                    className={`${ui.card} flex items-center justify-between gap-4 transition-colors hover:border-primary`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {personName(p)}
                      </span>
                      <span className="mt-0.5 block text-xs text-score-dim">
                        {p.roles.length > 0
                          ? p.roles.map((r) => ROLE_LABEL[r].replace(/s$/, "")).join(" · ")
                          : "No role"}
                        {p.displayName !== personName(p) && ` · “${p.displayName}”`}
                      </span>
                    </span>
                    <span className="flex flex-none items-center gap-2 text-xs text-score-dim">
                      {p.federationCode && (
                        <span className="rounded border border-border px-1.5 py-0.5">
                          {p.federationCode}
                        </span>
                      )}
                      {p.visPersonNo != null && (
                        <span
                          className="rounded border border-border px-1.5 py-0.5"
                          title="Linked to a VIS person record"
                        >
                          VIS {p.visPersonNo}
                        </span>
                      )}
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(page > 0 || hasMore) && (
            <div className="mt-4 flex items-center justify-between text-sm">
              {page > 0 ? (
                <Link href={pageHref(page - 1)} className={ui.btnSecondary}>
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-score-dim">
                {page * PEOPLE_PAGE_SIZE + 1}–
                {page * PEOPLE_PAGE_SIZE + rows.length}
              </span>
              {hasMore ? (
                <Link href={pageHref(page + 1)} className={ui.btnSecondary}>
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>

        <section>
          <NewPersonForm tenantSlug={tenantSlug} />
        </section>
      </div>
    </main>
  );
}
