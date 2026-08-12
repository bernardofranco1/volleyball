import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  listPlayersByTeam,
  listTeams,
} from "@/lib/competitions";
import {
  deletePlayer,
  deleteTeam,
  updatePlayer,
  updateTeam,
} from "@/lib/team-actions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddPlayerForm } from "@/components/admin/AddPlayerForm";
import { listTeamStaff, personName, searchPeople } from "@/lib/people";
import { TeamStaffPanel } from "@/components/admin/TeamStaffPanel";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// One team: its details, roster and staff. The teams index used to render this
// whole editor inline for EVERY team, which on a league-sized competition meant
// a page of a hundred-odd open form fields; it is now a list that drills in
// here. Discipline-agnostic, like the index.
export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string; teamId: string }>;
}) {
  const { tenantSlug, competitionId, teamId } = await params;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/teams/${teamId}`,
  );

  const [competition, teams] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    listTeams(competitionId),
  ]);
  if (!competition) notFound();
  // Resolved from the competition's own list, so a team id from another
  // competition (or a deleted one) can't be opened here.
  const team = teams.find((x) => x.id === teamId);
  if (!team) notFound();

  const [playersByTeam, registryPlayers, registryCoaches, staff] =
    await Promise.all([
      listPlayersByTeam([team.id]),
      searchPeople(ctx.tenant.id, { roles: ["PLAYER"], limit: 500 }),
      searchPeople(ctx.tenant.id, { roles: ["COACH"], limit: 500 }),
      listTeamStaff(ctx.tenant.id, team.id),
    ]);
  const roster = playersByTeam.get(team.id) ?? [];

  const teamsHref = `/t/${tenantSlug}/competitions/${competitionId}/teams`;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href={teamsHref} className="text-sm text-score-dim hover:text-foreground">
          {t("teams.backToTeams")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {team.displayName}
        </h1>
        <p className="mt-1 text-sm text-score-dim">
          {competition.name} · {t("teams.playerCount", { count: roster.length })}
        </p>
      </div>

      {/* ── Team details ── */}
      <section className={ui.card}>
        <h2 className="mb-3 font-medium">{t("teams.teamDetails")}</h2>
        <ActionForm action={updateTeam} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <input type="hidden" name="teamId" value={team.id} />
          <div className="flex-1">
            <label className={ui.label} htmlFor="team-name">
              {t("common.name")}
            </label>
            <input
              id="team-name"
              name="displayName"
              required
              defaultValue={team.displayName}
              className={ui.input}
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="team-country">
              {t("common.country")}
            </label>
            <input
              id="team-country"
              name="countryCode"
              defaultValue={team.countryCode ?? ""}
              maxLength={3}
              className={`${ui.input} w-20`}
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="team-seed">
              {t("common.seed")}
            </label>
            <input
              id="team-seed"
              name="seed"
              type="number"
              min={1}
              defaultValue={team.seed ?? ""}
              className={`${ui.input} w-16`}
            />
          </div>
          <SubmitButton variant="secondary" pendingLabel="…">
            {t("common.save")}
          </SubmitButton>
        </ActionForm>
      </section>

      {/* ── Roster ── */}
      <section className={`${ui.card} mt-6`}>
        <h2 className="mb-1 font-medium">{t("teams.roster")}</h2>
        <ul className="mt-2 divide-y divide-border">
          {roster.length === 0 ? (
            <li className="py-2 text-sm text-score-dim">{t("teams.noPlayers")}</li>
          ) : (
            roster.map((p) => (
              <li key={p.id} className="py-2">
                <ActionForm
                  action={updatePlayer}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="competitionId" value={competitionId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <input
                    name="jerseyNumber"
                    type="number"
                    min={0}
                    defaultValue={p.jerseyNumber ?? ""}
                    aria-label={t("common.jerseyNumber")}
                    placeholder="#"
                    className={`${ui.input} w-14 px-2 py-1 text-sm`}
                  />
                  {/* The name belongs to the person, not to this roster spot
                      (spec/24 §2.3) — editing it here would only change one
                      competition's copy. This row owns the jersey and the C/L
                      flags; the name links to the registry record. */}
                  <Link
                    href={`/t/${tenantSlug}/people/${p.personId}`}
                    className="w-36 flex-1 truncate px-1 text-sm hover:text-primary hover:underline sm:flex-none"
                    title={`Edit ${personName(p)} in People — shirt name “${p.jerseyName}”`}
                  >
                    {personName(p)}
                    {p.jerseyName !== personName(p) && (
                      <span className="ml-1 text-xs text-score-dim">
                        · {p.jerseyName}
                      </span>
                    )}
                  </Link>
                  <label className="flex items-center gap-1 text-xs text-score-dim">
                    <input
                      type="checkbox"
                      name="isCaptain"
                      defaultChecked={p.isCaptain}
                      aria-label={t("teams.isCaptain", { name: p.jerseyName })}
                    />
                    C
                  </label>
                  <label className="flex items-center gap-1 text-xs text-score-dim">
                    <input
                      type="checkbox"
                      name="isLibero"
                      defaultChecked={p.isLibero}
                      aria-label={t("teams.isLibero", { name: p.jerseyName })}
                    />
                    L
                  </label>
                  <button
                    type="submit"
                    className="text-xs text-score-dim hover:text-foreground"
                    aria-label={t("teams.savePlayer", { name: p.jerseyName })}
                  >
                    {t("common.save")}
                  </button>
                </ActionForm>
                <ActionForm
                  action={deletePlayer}
                  confirm={t("teams.removeConfirm", {
                    player: p.jerseyName,
                    team: team.displayName,
                  })}
                  className="mt-0.5"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="competitionId" value={competitionId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <button
                    type="submit"
                    className="text-xs text-score-dim hover:text-red-400"
                    aria-label={t("teams.removePlayer", { name: p.jerseyName })}
                  >
                    {t("common.remove")}
                  </button>
                </ActionForm>
              </li>
            ))
          )}
        </ul>

        <AddPlayerForm
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          teamId={team.id}
          people={registryPlayers}
        />

        <TeamStaffPanel
          tenantSlug={tenantSlug}
          teamId={team.id}
          people={registryCoaches}
          staff={staff}
        />
      </section>

      {/* ── Danger zone ── */}
      <section className={`${ui.card} mt-6`}>
        <ActionForm
          action={deleteTeam}
          confirm={t("teams.deleteConfirm", {
            team: team.displayName,
            count: roster.length,
          })}
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <input type="hidden" name="teamId" value={team.id} />
          <SubmitButton variant="danger" pendingLabel="…">
            {t("teams.deleteTeam")}
          </SubmitButton>
        </ActionForm>
      </section>
    </main>
  );
}
