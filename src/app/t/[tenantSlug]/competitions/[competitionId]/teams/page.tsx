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
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Page } from "@/components/ui/Page";
import { Toolbar, ToolbarSpacer } from "@/components/ui/Toolbar";
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

  type TeamRow = (typeof teams)[number];
  const columns: Column<TeamRow>[] = [
    {
      key: "seed",
      header: t("common.seed"),
      width: "w-12",
      align: "center",
      className: "font-mono tabular-nums text-xs text-score-dim",
      cell: (team) => team.seed ?? "—",
    },
    {
      key: "name",
      header: t("common.team"),
      cell: (team) => (
        <Link
          href={`/t/${tenantSlug}/competitions/${competitionId}/teams/${team.id}`}
          className="font-medium"
        >
          {team.displayName}
        </Link>
      ),
    },
    {
      key: "country",
      header: t("teams.country"),
      width: "w-20",
      cell: (team) => (
        <span className="text-xs text-score-dim">
          {team.countryCode ? team.countryCode.toUpperCase() : "—"}
        </span>
      ),
    },
    {
      key: "players",
      header: t("teams.players"),
      width: "w-20",
      align: "right",
      className: "font-mono tabular-nums text-xs",
      cell: (team) => (playersByTeam.get(team.id) ?? []).length,
    },
    {
      key: "captain",
      header: t("teams.captainShort"),
      className: "max-md:hidden",
      cell: (team) => {
        const captain = (playersByTeam.get(team.id) ?? []).find((p) => p.isCaptain);
        return (
          <span className="text-xs text-score-dim">
            {captain ? captain.jerseyName : "—"}
          </span>
        );
      },
    },
    {
      key: "go",
      header: "",
      align: "right",
      width: "w-16",
      cell: (team) => (
        <Link
          href={`/t/${tenantSlug}/competitions/${competitionId}/teams/${team.id}`}
          className="text-xs text-score-dim hover:text-foreground"
        >
          {t("teams.openRoster")} ›
        </Link>
      ),
    },
  ];

  return (
    <Page>
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="teams"
        subtitle={` · ${t("comp.teamsCount", { count: teams.length })}`}
      />

      <div className="mb-3">
        <Toolbar>
          <span className="text-sm text-score-dim">
            {t("comp.teamsCount", { count: teams.length })}
          </span>
          <ToolbarSpacer />
          <Drawer label={t("teams.addTeam")} variant="primary">
            <AddTeamForm tenantSlug={tenantSlug} competitionId={competitionId} />
          </Drawer>
          <Drawer label={t("teams.bulkTitle")}>
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
          </Drawer>
          <Drawer label={t("teams.importTitle")} width="lg">
          <CsvImport
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            title={t("teams.importTitle")}
            hint="Team,First name,Last name,Jersey,Captain,Libero — teams are created automatically; the John Doe example row is ignored"
            action={importRoster}
            templateHref={ROSTER_TEMPLATE}
            templateName="roster-template.csv"
          />
          </Drawer>
        </Toolbar>
      </div>

      <DataTable
        columns={columns}
        rowKey={(team) => team.id}
        density="cozy"
        groups={[{ key: "all", rows: teams }]}
        empty={t("teams.empty")}
      />
    </Page>
  );
}
