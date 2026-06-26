import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  getCompetitionConfig,
  listMatches,
  listTeams,
} from "@/lib/competitions";
import {
  setCompetitionStatus,
  updateCompetitionConfig,
} from "@/lib/competition-actions";
import { resolveConfig, type TournamentConfig } from "@/engine/config";
import type { Discipline } from "@/engine/types";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
import { EditCompetitionForm } from "@/components/admin/EditCompetitionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// The next lifecycle status the admin can advance to (DRAFT→ACTIVE→FINISHED),
// plus an optional "reopen" target.
const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [
    { to: "FINISHED", label: "Finish" },
    { to: "DRAFT", label: "Back to draft" },
  ],
  FINISHED: [{ to: "ACTIVE", label: "Reopen" }],
};

export default async function CompetitionOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}`,
  );

  const competition = await getCompetition(ctx.tenant.id, competitionId);
  if (!competition) notFound();

  const [configRow, teams, matches] = await Promise.all([
    getCompetitionConfig(competitionId),
    listTeams(competitionId),
    listMatches(competitionId),
  ]);

  const resolved = resolveConfig(
    competition.discipline as Discipline,
    (configRow ?? {}) as unknown as Partial<TournamentConfig>,
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/t/${tenantSlug}/competitions`}
            className="text-sm text-score-dim hover:text-foreground"
          >
            ← All competitions
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {competition.name}
            </h1>
            <span className={statusBadgeClass(competition.status)}>
              {competition.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-score-dim">
            {competition.discipline}
            {competition.gender && competition.gender !== "UNSPECIFIED"
              ? ` · ${competition.gender}`
              : ""}
            {` · ${teams.length} teams · ${matches.length} matches`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(NEXT_STATUS[competition.status] ?? []).map((t) => (
            <form key={t.to} action={setCompetitionStatus}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input
                type="hidden"
                name="competitionId"
                value={competitionId}
              />
              <input type="hidden" name="status" value={t.to} />
              <SubmitButton variant={t.to === "DRAFT" ? "secondary" : "primary"}>
                {t.label}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      <CompetitionTabs
        tenantSlug={tenantSlug}
        competitionId={competitionId}
        active="overview"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EditCompetitionForm
          tenantSlug={tenantSlug}
          competition={{
            id: competition.id,
            name: competition.name,
            venue: competition.venue,
            startDate: competition.startDate,
            endDate: competition.endDate,
          }}
        />

        {/* Config panel: overrides over discipline defaults. */}
        <form action={updateCompetitionConfig} className={ui.card}>
          <h2 className="mb-1 font-medium">Scoring rules</h2>
          <p className="mb-4 text-xs text-score-dim">
            Blank = use {competition.discipline} default. Resolved values shown as
            placeholders.
          </p>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={ui.label} htmlFor="bestOf">
                Best of
              </label>
              <input
                id="bestOf"
                name="bestOf"
                type="number"
                min={1}
                defaultValue={configRow?.bestOf ?? ""}
                placeholder={String(resolved.bestOf)}
                className={ui.input}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="setScore">
                Set score
              </label>
              <input
                id="setScore"
                name="setScore"
                type="number"
                min={1}
                defaultValue={configRow?.setScore ?? ""}
                placeholder={String(resolved.setScore)}
                className={ui.input}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="setScoreTiebreak">
                Tiebreak
              </label>
              <input
                id="setScoreTiebreak"
                name="setScoreTiebreak"
                type="number"
                min={1}
                defaultValue={configRow?.setScoreTiebreak ?? ""}
                placeholder={String(resolved.setScoreTiebreak)}
                className={ui.input}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="serveClockEnabled"
                defaultChecked={resolved.serveClockEnabled}
              />
              Serve clock enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="ttoEnabled"
                defaultChecked={resolved.ttoEnabled}
              />
              Technical time-out (TTO) enabled
            </label>
          </div>

          <div className="mt-4">
            <SubmitButton pendingLabel="Saving…">Save rules</SubmitButton>
          </div>
        </form>
      </div>
    </main>
  );
}
