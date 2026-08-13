// Person editor (spec/24 §6.1). Shows the record, and — importantly — where it
// is used: a name correction here reaches every roster and every future
// scoresheet, so an admin should be able to see the blast radius before saving.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  findDuplicateCandidates,
  getPerson,
  personName,
  personUsage,
} from "@/lib/people";
import {
  DeletePersonForm,
  EditPersonForm,
  MergePeopleForm,
} from "@/components/admin/PersonForm";
import { Page } from "@/components/ui/Page";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; personId: string }>;
}) {
  const { tenantSlug, personId } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/people/${personId}`,
  );

  const [person, usage, duplicates] = await Promise.all([
    getPerson(ctx.tenant.id, personId),
    personUsage(ctx.tenant.id, personId),
    findDuplicateCandidates(ctx.tenant.id, personId),
  ]);
  if (!person) notFound();

  return (
    <Page>
      <Link
        href={`/t/${tenantSlug}/people`}
        className="text-sm text-score-dim hover:text-foreground"
      >
        ← People
      </Link>

      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {personName(person)}
        </h1>
        {person.federationCode && (
          <span className="rounded border border-border px-2 py-0.5 text-xs text-score-dim">
            {person.federationCode}
          </span>
        )}
        {person.visPersonNo != null && (
          <span className="rounded border border-border px-2 py-0.5 text-xs text-score-dim">
            VIS {person.visPersonNo}
          </span>
        )}
        {person.userId && (
          <span
            className="rounded border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-400"
            title="This person can sign in — they will be able to see their own nominations in the Referees' Hub"
          >
            Has login
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section>
          <EditPersonForm tenantSlug={tenantSlug} person={person} />
        </section>

        <section className="space-y-6">
          <div className={ui.card}>
            <h3 className="mb-3 font-medium">Where this person appears</h3>
            {!usage.inUse ? (
              <p className="text-sm text-score-dim">
                Not referenced anywhere yet. Add them to a roster from a
                competition&apos;s Teams tab, or to a match&apos;s officials.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                {usage.rosters.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-score-dim">
                      Rosters
                    </p>
                    <ul className="space-y-1">
                      {usage.rosters.map((r, i) => (
                        <li key={i}>
                          {r.teamName}
                          {r.jerseyNumber != null && ` #${r.jerseyNumber}`}
                          <span className="text-score-dim"> · {r.competitionName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {usage.staff.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-score-dim">
                      Team staff
                    </p>
                    <ul className="space-y-1">
                      {usage.staff.map((s, i) => (
                        <li key={i}>
                          {s.function.replace(/_/g, " ").toLowerCase()} ·{" "}
                          {s.teamName}
                          <span className="text-score-dim"> · {s.competitionName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {usage.officials.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-score-dim">
                      Match officials
                    </p>
                    <ul className="space-y-1">
                      {usage.officials.map((o, i) => (
                        <li key={i}>
                          {o.role.replace(/_/g, " ").toLowerCase()}
                          <span className="text-score-dim"> · {o.competitionName}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-score-dim">
                      Officials names are also stored on each match as they were
                      printed, so editing this record does not rewrite a
                      scoresheet that has already been signed.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <MergePeopleForm
            tenantSlug={tenantSlug}
            targetId={person.id}
            targetName={personName(person)}
            candidates={duplicates}
          />

          <DeletePersonForm
            tenantSlug={tenantSlug}
            personId={person.id}
            inUse={usage.inUse}
          />
        </section>
      </div>
    </Page>
  );
}
