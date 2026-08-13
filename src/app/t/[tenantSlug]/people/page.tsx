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
  peopleSummaries,
  personName,
  PEOPLE_PAGE_SIZE,
  PERSON_ROLES,
  type PersonRole,
  type PersonRow,
} from "@/lib/people";
import { NewPersonForm } from "@/components/admin/PersonForm";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Page, PageHeader } from "@/components/ui/Page";
import { FilterChip, SearchBox, Toolbar, ToolbarSpacer } from "@/components/ui/Toolbar";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<PersonRole, string> = {
  PLAYER: "Players",
  REFEREE: "Referees",
  COACH: "Coaches",
  SCORER: "Scorers",
};

const OFFICIAL_ROLE_LABEL: Record<string, string> = {
  FIRST_REFEREE: "1st referee",
  SECOND_REFEREE: "2nd referee",
  SCORER: "scorer",
  ASSISTANT_SCORER: "assistant scorer",
  THIRD_REFEREE: "3rd referee",
  CHALLENGE_REFEREE: "challenge referee",
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
  const summaries = await peopleSummaries(
    ctx.tenant.id,
    rows.map((r) => r.id),
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

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

  const columns: Column<PersonRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <Link href={`/t/${tenantSlug}/people/${p.id}`} className="font-medium">
          {personName(p)}
        </Link>
      ),
    },
    {
      key: "shirt",
      header: "Shirt name",
      className: "max-lg:hidden",
      cell: (p) => (
        <span className="text-xs text-score-dim">{p.jerseyName}</span>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      width: "w-40",
      cell: (p) => (
        <span className="text-xs text-score-dim">
          {p.roles.length > 0
            ? p.roles.map((r) => ROLE_LABEL[r].replace(/s$/, "")).join(" · ")
            : "—"}
        </span>
      ),
    },
    {
      key: "birthdate",
      header: "Born",
      width: "w-28",
      className: "max-xl:hidden font-mono tabular-nums text-xs",
      cell: (p) => (
        <span className="text-score-dim">{p.birthdate ?? "—"}</span>
      ),
    },
    {
      key: "federation",
      header: "Federation",
      width: "w-24",
      className: "max-md:hidden",
      cell: (p) => (
        <span className="text-xs text-score-dim">{p.federationCode ?? "—"}</span>
      ),
    },
    {
      key: "vis",
      header: "VIS",
      width: "w-20",
      className: "max-xl:hidden font-mono tabular-nums text-xs",
      cell: (p) => (
        <span className="text-score-dim">{p.visPersonNo ?? "—"}</span>
      ),
    },
    {
      key: "login",
      header: "Login",
      width: "w-16",
      align: "center",
      cell: (p) =>
        p.hasLogin ? (
          <span className="text-success" title="Has a login account">
            ✓
          </span>
        ) : (
          <span className="text-score-dim">—</span>
        ),
    },
    {
      key: "teams",
      header: "Appears in",
      cell: (p) => {
        const s = summaries.get(p.id);
        const bits: string[] = [];
        if (s?.teams.length) bits.push(s.teams.slice(0, 2).join(", "));
        if (s?.teams.length && s.teams.length > 2)
          bits.push(`+${s.teams.length - 2}`);
        if (s?.officialAppearances)
          bits.push(
            `${s.officialAppearances} match${s.officialAppearances === 1 ? "" : "es"}${
              s.topOfficialRole
                ? ` as ${OFFICIAL_ROLE_LABEL[s.topOfficialRole] ?? s.topOfficialRole}`
                : ""
            }`,
          );
        return (
          <span className="block truncate text-xs text-score-dim">
            {bits.join(" · ") || "—"}
          </span>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        title="People"
        meta={`Players, referees, coaches and scorers for ${ctx.tenant.name}. Rosters and match officials reference these records, so a correction here reaches every competition.`}
        actions={
          // Was a permanent 340px rail beside the directory it competes with.
          <Drawer label="Add person" variant="primary" width="lg">
            <NewPersonForm tenantSlug={tenantSlug} />
          </Drawer>
        }
      />

      <div className="mb-3">
        <Toolbar>
          <SearchBox
            defaultValue={q}
            placeholder="Name…"
            carry={{ role }}
          />
          <FilterChip href={chipHref()} active={!role} label="All" count={total} />
          {PERSON_ROLES.map((r) => (
            <FilterChip
              key={r}
              href={chipHref(r)}
              active={role === r}
              label={ROLE_LABEL[r]}
              count={counts[r]}
            />
          ))}
          <ToolbarSpacer />
        </Toolbar>
      </div>

      <DataTable
        columns={columns}
        rowKey={(p) => p.id}
        density="compact"
        groups={[{ key: "all", rows }]}
        empty={
          q || role
            ? "Nobody matches that filter."
            : "No people yet. Add someone, or import a roster from the Teams tab of a competition — imported names are matched to existing people and created when new."
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <span>
              {rows.length === 0 ? 0 : page * PEOPLE_PAGE_SIZE + 1}–
              {page * PEOPLE_PAGE_SIZE + rows.length}
              {role ? ` of ${counts[role]}` : ` of ${total}`}
            </span>
            <span className="flex items-center gap-1">
              {page > 0 && (
                <Link href={pageHref(page - 1)} className="px-2 hover:text-foreground">
                  ←
                </Link>
              )}
              {Array.from(
                {
                  length: Math.max(
                    1,
                    Math.ceil((role ? counts[role] : total) / PEOPLE_PAGE_SIZE),
                  ),
                },
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
    </Page>
  );
}
