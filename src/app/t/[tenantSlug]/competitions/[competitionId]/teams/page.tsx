import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  listPlayersByTeam,
  listTeams,
} from "@/lib/competitions";
import {
  bulkAddTeams,
  deletePlayer,
  deleteTeam,
  updatePlayer,
  updateTeam,
} from "@/lib/team-actions";
import { importRoster } from "@/lib/csv-actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddTeamForm } from "@/components/admin/AddTeamForm";
import { AddPlayerForm } from "@/components/admin/AddPlayerForm";
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

  const [competition, teams] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    listTeams(competitionId),
  ]);
  if (!competition) notFound();
  const playersByTeam = await listPlayersByTeam(teams.map((t) => t.id));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="teams"
        subtitle={` · ${teams.length} teams`}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4 lg:order-none order-last">
          {teams.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              No teams yet. Add them below — one at a time, several at once, or
              via CSV import.
            </div>
          ) : (
            teams.map((team) => {
              const roster = playersByTeam.get(team.id) ?? [];
              return (
                <div key={team.id} className={ui.card}>
                  <ActionForm
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
                      <label className={ui.label} htmlFor={`name-${team.id}`}>
                        Name
                      </label>
                      <input
                        id={`name-${team.id}`}
                        name="displayName"
                        required
                        defaultValue={team.displayName}
                        className={ui.input}
                      />
                    </div>
                    <div>
                      <label
                        className={ui.label}
                        htmlFor={`country-${team.id}`}
                      >
                        Country
                      </label>
                      <input
                        id={`country-${team.id}`}
                        name="countryCode"
                        defaultValue={team.countryCode ?? ""}
                        maxLength={3}
                        className={`${ui.input} w-20`}
                      />
                    </div>
                    <div>
                      <label className={ui.label} htmlFor={`seed-${team.id}`}>
                        Seed
                      </label>
                      <input
                        id={`seed-${team.id}`}
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
                  </ActionForm>

                  {/* Roster — each player is editable in place. */}
                  <ul className="mt-4 divide-y divide-border">
                    {roster.length === 0 ? (
                      <li className="py-2 text-sm text-score-dim">
                        No players yet.
                      </li>
                    ) : (
                      roster.map((p) => (
                        <li key={p.id} className="py-2">
                          <ActionForm
                            action={updatePlayer}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
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
                            <input type="hidden" name="playerId" value={p.id} />
                            <input
                              name="jerseyNumber"
                              type="number"
                              min={0}
                              defaultValue={p.jerseyNumber ?? ""}
                              aria-label="Jersey number"
                              placeholder="#"
                              className={`${ui.input} w-14 px-2 py-1 text-sm`}
                            />
                            <input
                              name="firstName"
                              defaultValue={p.firstName ?? ""}
                              aria-label="First name"
                              placeholder="First name"
                              className={`${ui.input} w-28 flex-1 px-2 py-1 text-sm sm:flex-none`}
                            />
                            <input
                              name="lastName"
                              defaultValue={p.lastName ?? ""}
                              aria-label="Last name"
                              placeholder="Last name"
                              className={`${ui.input} w-28 flex-1 px-2 py-1 text-sm sm:flex-none`}
                            />
                            <label className="flex items-center gap-1 text-xs text-score-dim">
                              <input
                                type="checkbox"
                                name="isCaptain"
                                defaultChecked={p.isCaptain}
                                aria-label={`${p.fullName} is captain`}
                              />
                              C
                            </label>
                            <label className="flex items-center gap-1 text-xs text-score-dim">
                              <input
                                type="checkbox"
                                name="isLibero"
                                defaultChecked={p.isLibero}
                                aria-label={`${p.fullName} is libero`}
                              />
                              L
                            </label>
                            <button
                              type="submit"
                              className="text-xs text-score-dim hover:text-foreground"
                              aria-label={`Save ${p.fullName}`}
                            >
                              Save
                            </button>
                          </ActionForm>
                          <ActionForm
                            action={deletePlayer}
                            confirm={`Remove ${p.fullName} from ${team.displayName}?`}
                            className="mt-0.5"
                          >
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
                            <input type="hidden" name="playerId" value={p.id} />
                            <button
                              type="submit"
                              className="text-xs text-score-dim hover:text-red-400"
                              aria-label={`Remove ${p.fullName}`}
                            >
                              Remove
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
                  />

                  <div className="mt-4 border-t border-border pt-3">
                    <ActionForm
                      action={deleteTeam}
                      confirm={`Delete ${team.displayName} and its ${roster.length} player(s)? This cannot be undone.`}
                    >
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
                    </ActionForm>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <aside className="order-first space-y-6 lg:order-none">
          <AddTeamForm tenantSlug={tenantSlug} competitionId={competitionId} />

          <ActionForm action={bulkAddTeams} className={ui.card} resetOnOk>
            <h2 className="mb-1 font-medium">Bulk add teams</h2>
            <p className="mb-3 text-xs text-score-dim">
              One team per line, optional “,country” suffix. Existing names are
              skipped.
            </p>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <label className="sr-only" htmlFor="bulk-names">
              Team names
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
              <SubmitButton variant="secondary" pendingLabel="Adding…">
                Add all
              </SubmitButton>
            </div>
          </ActionForm>

          <CsvImport
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            title="Import teams & players"
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
