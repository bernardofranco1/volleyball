import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  listPlayersByTeam,
  listTeams,
} from "@/lib/competitions";
import { deletePlayer, deleteTeam, updateTeam } from "@/lib/team-actions";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
import { AddTeamForm } from "@/components/admin/AddTeamForm";
import { AddPlayerForm } from "@/components/admin/AddPlayerForm";
import { CsvImport } from "@/components/admin/CsvImport";
import { importRoster } from "@/lib/csv-actions";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/teams`,
  );

  const competition = await getCompetition(ctx.tenant.id, competitionId);
  if (!competition) notFound();

  const teams = await listTeams(competitionId);
  const playersByTeam = await listPlayersByTeam(teams.map((t) => t.id));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        {competition.name}
      </h1>
      <p className="mt-1 text-sm text-score-dim">Teams &amp; players</p>

      <div className="mt-6">
        <CompetitionTabs
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          active="teams"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          {teams.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              No teams yet. Add one on the right.
            </div>
          ) : (
            teams.map((team) => {
              const roster = playersByTeam.get(team.id) ?? [];
              return (
                <div key={team.id} className={ui.card}>
                  <form
                    action={updateTeam}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input
                      type="hidden"
                      name="competitionId"
                      value={competitionId}
                    />
                    <input type="hidden" name="teamId" value={team.id} />
                    <div className="flex-1">
                      <label className={ui.label}>Name</label>
                      <input
                        name="displayName"
                        defaultValue={team.displayName}
                        className={ui.input}
                      />
                    </div>
                    <div>
                      <label className={ui.label}>Country</label>
                      <input
                        name="countryCode"
                        defaultValue={team.countryCode ?? ""}
                        maxLength={3}
                        className={`${ui.input} w-20`}
                      />
                    </div>
                    <div>
                      <label className={ui.label}>Seed</label>
                      <input
                        name="seed"
                        type="number"
                        min={1}
                        defaultValue={team.seed ?? ""}
                        className={`${ui.input} w-16`}
                      />
                    </div>
                    <SubmitButton variant="secondary" pendingLabel="…">
                      Save
                    </SubmitButton>
                  </form>

                  {/* Roster */}
                  <ul className="mt-4 divide-y divide-border">
                    {roster.length === 0 ? (
                      <li className="py-2 text-sm text-score-dim">
                        No players yet.
                      </li>
                    ) : (
                      roster.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between py-2 text-sm"
                        >
                          <span>
                            <span className="inline-block w-8 text-score-dim">
                              {p.jerseyNumber ?? "–"}
                            </span>
                            {p.fullName}
                            {p.isCaptain && (
                              <span className="ml-2 text-xs text-primary">
                                (C)
                              </span>
                            )}
                            {p.isLibero && (
                              <span className="ml-2 text-xs text-amber-400">
                                (L)
                              </span>
                            )}
                          </span>
                          <form action={deletePlayer}>
                            <input
                              type="hidden"
                              name="tenantSlug"
                              value={tenantSlug}
                            />
                            <input
                              type="hidden"
                              name="competitionId"
                              value={competitionId}
                            />
                            <input
                              type="hidden"
                              name="playerId"
                              value={p.id}
                            />
                            <button
                              type="submit"
                              className="text-xs text-score-dim hover:text-red-400"
                              aria-label={`Remove ${p.fullName}`}
                            >
                              Remove
                            </button>
                          </form>
                        </li>
                      ))
                    )}
                  </ul>

                  <AddPlayerForm
                    tenantSlug={tenantSlug}
                    competitionId={competitionId}
                    teamId={team.id}
                  />

                  <div className="mt-4 border-t border-border pt-3">
                    <form action={deleteTeam}>
                      <input
                        type="hidden"
                        name="tenantSlug"
                        value={tenantSlug}
                      />
                      <input
                        type="hidden"
                        name="competitionId"
                        value={competitionId}
                      />
                      <input type="hidden" name="teamId" value={team.id} />
                      <SubmitButton variant="danger" pendingLabel="…">
                        Delete team
                      </SubmitButton>
                    </form>
                    <p className="mt-1 text-xs text-score-dim">
                      Teams already used in a match can’t be deleted.
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <aside className="space-y-6">
          <AddTeamForm
            tenantSlug={tenantSlug}
            competitionId={competitionId}
          />
          <CsvImport
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            title="Import teams & players"
            hint="Team,First name,Last name,Jersey,Captain,Libero — teams are created automatically; the first data row is an ignored example"
            action={importRoster}
          />
        </aside>
      </div>
    </main>
  );
}
