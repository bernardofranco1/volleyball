import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition, listMatches, listTeams } from "@/lib/competitions";
import {
  deleteMatch,
  generateRoundRobin,
  updateMatchSlot,
} from "@/lib/schedule-actions";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
import { AddMatchForm } from "@/components/admin/AddMatchForm";
import { CsvImport } from "@/components/admin/CsvImport";
import { importSchedule } from "@/lib/csv-actions";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

/** Date → value for <input type="datetime-local"> (UTC, minute precision). */
function toLocalInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 16) : "";
}

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

  const competition = await getCompetition(ctx.tenant.id, competitionId);
  if (!competition) notFound();

  const [teams, matchList] = await Promise.all([
    listTeams(competitionId),
    listMatches(competitionId),
  ]);
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        {competition.name}
      </h1>
      <p className="mt-1 text-sm text-score-dim">Match schedule</p>

      <div className="mt-6">
        <CompetitionTabs
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          active="schedule"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">{matchList.length} matches</h2>
            {teams.length >= 2 && (
              <form action={generateRoundRobin}>
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input
                  type="hidden"
                  name="competitionId"
                  value={competitionId}
                />
                <SubmitButton variant="secondary" pendingLabel="Generating…">
                  Generate round-robin
                </SubmitButton>
              </form>
            )}
          </div>

          {matchList.length === 0 ? (
            <div className={`${ui.card} text-sm text-score-dim`}>
              No matches scheduled yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {matchList.map((m) => (
                <li key={m.id} className={ui.card}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
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
                    </div>
                    <Link
                      href={`${base}/matches/${m.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Details →
                    </Link>
                  </div>

                  <form
                    action={updateMatchSlot}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input
                      type="hidden"
                      name="competitionId"
                      value={competitionId}
                    />
                    <input type="hidden" name="matchId" value={m.id} />
                    <div>
                      <label className={ui.label}>Court</label>
                      <input
                        name="courtNumber"
                        type="number"
                        min={1}
                        defaultValue={m.courtNumber ?? ""}
                        className={`${ui.input} w-20`}
                      />
                    </div>
                    <div>
                      <label className={ui.label}>Round</label>
                      <input
                        name="roundName"
                        defaultValue={m.roundName ?? ""}
                        className={`${ui.input} w-28`}
                      />
                    </div>
                    <div>
                      <label className={ui.label}>Time (UTC)</label>
                      <input
                        name="scheduledAt"
                        type="datetime-local"
                        defaultValue={toLocalInput(m.scheduledAt)}
                        className={ui.input}
                      />
                    </div>
                    <SubmitButton variant="secondary" pendingLabel="…">
                      Save
                    </SubmitButton>
                  </form>

                  {m.status === "SCHEDULED" && (
                    <form action={deleteMatch} className="mt-2">
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
                      <button
                        type="submit"
                        className="text-xs text-score-dim hover:text-red-400"
                      >
                        Delete match
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
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
          />
        </aside>
      </div>
    </main>
  );
}
