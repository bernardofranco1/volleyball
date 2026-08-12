import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  listPlayersByTeam,
  listTeams,
} from "@/lib/competitions";
import { bulkAddTeams } from "@/lib/team-actions";
import { importRoster } from "@/lib/csv-actions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddTeamForm } from "@/components/admin/AddTeamForm";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { CsvImport } from "@/components/admin/CsvImport";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// Downloadable roster template matching importRoster's tolerant headers; the
// John Doe line is recognised by content and ignored on import.
const ROSTER_TEMPLATE =
  "data:text/csv;charset=utf-8," +
  encodeURIComponent(
    "Team,First name,Last name,Jersey,Captain,Libero,Country\n" +
      "Example Team,John,Doe,7,yes,no,SUI\n",
  );

// Teams index: one compact row per team, drilling into [teamId] for the
// details, roster and staff. It used to render every team's full editor inline,
// which for a league of eight 14-player squads was hundreds of open inputs on
// one page. Adding teams stays here, where it applies to the whole list.
export default async function TeamsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/teams`,
  );

  const [competition, teams] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    listTeams(competitionId),
  ]);
  if (!competition) notFound();
  const playersByTeam = await listPlayersByTeam(teams.map((x) => x.id));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="teams"
        subtitle={` · ${t("comp.teamsCount", { count: teams.length })}`}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section className="space-y-2 lg:order-none order-last">
          {teams.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              {t("teams.empty")}
            </div>
          ) : (
            teams.map((team) => {
              const roster = playersByTeam.get(team.id) ?? [];
              const captain = roster.find((p) => p.isCaptain);
              return (
                <Link
                  key={team.id}
                  href={`/t/${tenantSlug}/competitions/${competitionId}/teams/${team.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 transition-colors hover:border-primary"
                >
                  {team.seed != null && (
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface text-xs font-medium text-score-dim"
                      title={t("common.seed")}
                    >
                      {team.seed}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {team.displayName}
                      {team.countryCode && (
                        <span className="ml-2 text-xs font-normal text-score-dim">
                          {team.countryCode.toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-score-dim">
                      {t("teams.playerCount", { count: roster.length })}
                      {captain && ` · ${t("teams.captainShort")} ${captain.jerseyName}`}
                    </span>
                  </span>
                  <span aria-hidden className="text-score-dim">
                    ›
                  </span>
                </Link>
              );
            })
          )}
        </section>

        <aside className="order-first space-y-6 lg:order-none">
          <AddTeamForm tenantSlug={tenantSlug} competitionId={competitionId} />

          <ActionForm action={bulkAddTeams} className={ui.card} resetOnOk>
            <h2 className="mb-1 font-medium">{t("teams.bulkTitle")}</h2>
            <p className="mb-3 text-xs text-score-dim">{t("teams.bulkHint")}</p>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <label className="sr-only" htmlFor="bulk-names">
              {t("teams.bulkLabel")}
            </label>
            <textarea
              id="bulk-names"
              name="names"
              rows={5}
              required
              placeholder={"Berlin BR Volleys,GER\nTrentino Itas,ITA"}
              className={`${ui.input} font-mono`}
            />
            <div className="mt-3">
              <SubmitButton variant="secondary" pendingLabel={t("common.adding")}>
                {t("teams.addAll")}
              </SubmitButton>
            </div>
          </ActionForm>

          <CsvImport
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            title={t("teams.importTitle")}
            hint="Team,First name,Last name,Jersey,Captain,Libero — teams are created automatically; the John Doe example row is ignored"
            action={importRoster}
            templateHref={ROSTER_TEMPLATE}
            templateName="roster-template.csv"
          />
        </aside>
      </div>
    </main>
  );
}
