import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  listMatches,
  listTeams,
  type MatchRow,
} from "@/lib/competitions";
import {
  deleteMatch,
  generateRoundRobin,
  updateMatchSlot,
} from "@/lib/schedule-actions";
import { importSchedule } from "@/lib/csv-actions";
import { toUtcInputValue } from "@/lib/form-data";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddMatchForm } from "@/components/admin/AddMatchForm";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { CsvImport } from "@/components/admin/CsvImport";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { LocalTime } from "@/components/LocalTime";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const SCHEDULE_TEMPLATE =
  "data:text/csv;charset=utf-8," +
  encodeURIComponent(
    "Match number,Team A,Team B,Court number,Group,Phase number,Phase name,Match day,Match time (local)\n" +
      "1,Team Alpha,Team Beta,1,,,Pool play,2026-07-12,14:00\n",
  );

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/schedule`,
  );

  const [competition, teams, matchList] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    listTeams(competitionId),
    listMatches(competitionId),
  ]);
  if (!competition) notFound();
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;

  // Group by round so a full-season schedule doesn't render as one endless
  // list; fully-finished rounds start collapsed.
  const groups = new Map<string, MatchRow[]>();
  for (const m of matchList) {
    const key = m.roundName ?? "Unassigned round";
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="schedule"
        subtitle={` · ${matchList.length} matches`}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section className={matchList.length === 0 ? "order-last lg:order-none" : ""}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">{matchList.length} matches</h2>
            {teams.length >= 2 && (
              <ActionForm
                action={generateRoundRobin}
                confirm="Generate round-robin fixtures for every unplayed pairing? With pools, each pool gets its own round-robin."
              >
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input
                  type="hidden"
                  name="competitionId"
                  value={competitionId}
                />
                <SubmitButton variant="secondary" pendingLabel="Generating…">
                  Generate round-robin
                </SubmitButton>
              </ActionForm>
            )}
          </div>

          {matchList.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              No matches scheduled yet. Create one, generate a round-robin, or
              import a CSV.
            </div>
          ) : (
            <div className="space-y-4">
              {[...groups.entries()].map(([roundName, ms]) => {
                const allFinished = ms.every((m) => m.status === "FINISHED");
                return (
                  <details key={roundName} open={!allFinished}>
                    <summary className="mb-2 cursor-pointer text-sm font-medium text-score-dim">
                      {roundName}{" "}
                      <span className="font-normal">
                        · {ms.length} match{ms.length === 1 ? "" : "es"}
                        {allFinished ? " · finished" : ""}
                      </span>
                    </summary>
                    <ul className="space-y-3">
                      {ms.map((m) => (
                        <li key={m.id} className={ui.card}>
                          {/* Header is the link to the match page; the edit forms
                              below stay interactive. */}
                          <Link
                            href={`${base}/matches/${m.id}`}
                            className="-m-1 flex items-center justify-between gap-3 rounded-lg p-1 transition-colors hover:bg-surface"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-score-dim">
                                #{m.matchNumber ?? "–"}
                              </span>
                              <span className="font-medium">
                                {m.teamAName} vs {m.teamBName}
                              </span>
                              <span className={statusBadgeClass(m.status)}>
                                {m.status}
                              </span>
                              {(m.setsWonA > 0 || m.setsWonB > 0) && (
                                <span className="text-sm text-score-dim">
                                  {m.setsWonA}–{m.setsWonB}
                                </span>
                              )}
                              {m.scheduledAt && (
                                <span className="text-xs text-score-dim">
                                  <LocalTime date={m.scheduledAt} />
                                </span>
                              )}
                            </div>
                            <span className="flex-none text-sm text-primary">
                              Details →
                            </span>
                          </Link>

                          <ActionForm
                            action={updateMatchSlot}
                            className="mt-3 flex flex-wrap items-end gap-2"
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
                            <input type="hidden" name="matchId" value={m.id} />
                            <div>
                              <label
                                className={ui.label}
                                htmlFor={`court-${m.id}`}
                              >
                                Court
                              </label>
                              <input
                                id={`court-${m.id}`}
                                name="courtNumber"
                                type="number"
                                min={1}
                                defaultValue={m.courtNumber ?? ""}
                                className={`${ui.input} w-20`}
                              />
                            </div>
                            <div>
                              <label
                                className={ui.label}
                                htmlFor={`round-${m.id}`}
                              >
                                Round
                              </label>
                              <input
                                id={`round-${m.id}`}
                                name="roundName"
                                defaultValue={m.roundName ?? ""}
                                className={`${ui.input} w-28`}
                              />
                            </div>
                            <div>
                              <label
                                className={ui.label}
                                htmlFor={`time-${m.id}`}
                              >
                                Time (UTC)
                              </label>
                              <input
                                id={`time-${m.id}`}
                                name="scheduledAt"
                                type="datetime-local"
                                defaultValue={toUtcInputValue(m.scheduledAt)}
                                className={ui.input}
                              />
                            </div>
                            <SubmitButton variant="secondary" pendingLabel="…">
                              Save
                            </SubmitButton>
                          </ActionForm>

                          {m.status === "SCHEDULED" && (
                            <ActionForm
                              action={deleteMatch}
                              confirm={`Delete match #${m.matchNumber ?? ""} ${m.teamAName} vs ${m.teamBName}?`}
                              className="mt-2"
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
                              <input
                                type="hidden"
                                name="matchId"
                                value={m.id}
                              />
                              <button
                                type="submit"
                                className="text-xs text-score-dim hover:text-red-400"
                              >
                                Delete match
                              </button>
                            </ActionForm>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        <aside className="order-first space-y-6 lg:order-none">
          <AddMatchForm
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            teams={teams.map((t) => ({
              id: t.id,
              displayName: t.displayName,
            }))}
          />
          <CsvImport
            tenantSlug={tenantSlug}
            competitionId={competitionId}
            title="Import schedule"
            hint="Match number,Team A,Team B,Court number,Group,Phase number,Phase name,Match day,Match time (local)"
            action={importSchedule}
            templateHref={SCHEDULE_TEMPLATE}
            templateName="schedule-template.csv"
          />
        </aside>
      </div>
    </main>
  );
}
