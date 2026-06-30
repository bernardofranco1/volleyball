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
  updateCompetitionBranding,
} from "@/lib/competition-actions";
import { resolveConfig, type TournamentConfig } from "@/engine/config";
import {
  getCompetitionBranding,
  defaultBoardTheme,
  BOARD_FONTS,
} from "@/lib/board-theme";
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

  const [configRow, teams, matches, boardBranding] = await Promise.all([
    getCompetitionConfig(competitionId),
    listTeams(competitionId),
    listMatches(competitionId),
    getCompetitionBranding(competitionId),
  ]);

  const resolved = resolveConfig(
    competition.discipline as Discipline,
    (configRow ?? {}) as unknown as Partial<TournamentConfig>,
  );
  const boardDefault = defaultBoardTheme(competition.discipline as Discipline);

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

          {(competition.discipline === "LIGHT" ||
            competition.discipline === "GRASS") && (
            <div className="mt-4">
              <label className={ui.label} htmlFor="playersPerSide">
                Players per team{" "}
                <span className="font-normal text-score-dim">
                  — mandatory; each team must field exactly this many
                </span>
              </label>
              <select
                id="playersPerSide"
                name="playersPerSide"
                defaultValue={configRow?.playersPerSide ?? ""}
                className={ui.input}
              >
                <option value="">Default ({resolved.playersPerSide})</option>
                {(competition.discipline === "LIGHT" ? [4, 5] : [3, 4]).map(
                  (nP) => (
                    <option key={nP} value={nP}>
                      {nP} players
                    </option>
                  ),
                )}
              </select>
            </div>
          )}

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

        {/* Scoreboard appearance — per-competition broadcast-board theme. */}
        <form action={updateCompetitionBranding} className={ui.card}>
          <h2 className="mb-1 font-medium">Scoreboard</h2>
          <p className="mb-3 text-[11px] text-score-dim">
            Appearance of the public broadcast board for this competition.
          </p>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["bgColor", "Background", boardDefault.bg],
                ["lineColor", "Lines", boardDefault.line],
                ["accentColor", "Accent", boardDefault.accent],
                ["fontColor", "Text", boardDefault.font],
              ] as const
            ).map(([key, label, dflt]) => (
              <div key={key}>
                <label className={ui.label} htmlFor={key}>
                  {label}
                </label>
                <input
                  id={key}
                  name={key}
                  type="color"
                  defaultValue={
                    (boardBranding?.[key] as string | null) ?? dflt
                  }
                  className="h-9 w-full rounded-lg border border-border bg-surface"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className={ui.label} htmlFor="board-font">
              Font family
            </label>
            <select
              id="board-font"
              name="fontFamily"
              defaultValue={boardBranding?.fontFamily ?? ""}
              className={ui.input}
            >
              <option value="">Default (Saira Condensed)</option>
              {BOARD_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3">
            <label className={ui.label} htmlFor="board-logo">
              Competition logo URL
            </label>
            <input
              id="board-logo"
              name="logoUrl"
              defaultValue={boardBranding?.logoUrl ?? ""}
              placeholder="https://… (transparent .png)"
              className={ui.input}
            />
          </div>
          <div className="mt-4">
            <SubmitButton variant="secondary" pendingLabel="Saving…">
              Save scoreboard
            </SubmitButton>
          </div>
        </form>
      </div>
    </main>
  );
}
