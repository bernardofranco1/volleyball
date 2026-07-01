import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  competitionCounts,
  getCompetition,
  getCompetitionConfig,
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
import { NEXT_STATUS, PLAYERS_PER_SIDE } from "@/lib/domain";
import { ActionForm } from "@/components/admin/ActionForm";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { EditCompetitionForm } from "@/components/admin/EditCompetitionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const STATUS_CONFIRM: Record<string, string | undefined> = {
  FINISHED:
    "Finish this competition? Public results freeze at the current standings.",
  ACTIVE: undefined,
  DRAFT: undefined,
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

  // Everything is independent — fetch concurrently, gate on the result.
  const [competition, configRow, counts, boardBranding] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    getCompetitionConfig(competitionId),
    competitionCounts(competitionId),
    getCompetitionBranding(competitionId),
  ]);
  if (!competition) notFound();

  const discipline = competition.discipline as Discipline;
  const resolved = resolveConfig(
    discipline,
    (configRow ?? {}) as unknown as Partial<TournamentConfig>,
  );
  const boardDefault = defaultBoardTheme(discipline);
  const triState = (v: boolean | null | undefined) =>
    v == null ? "" : v ? "on" : "off";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="overview"
        subtitle={` · ${counts.teams} teams · ${counts.matches} matches`}
        actions={(NEXT_STATUS[competition.status] ?? []).map((t) => (
          <ActionForm
            key={t.to}
            action={setCompetitionStatus}
            confirm={STATUS_CONFIRM[t.to]}
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <input type="hidden" name="status" value={t.to} />
            <SubmitButton variant={t.to === "DRAFT" ? "secondary" : "primary"}>
              {t.label}
            </SubmitButton>
          </ActionForm>
        ))}
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
            gender: competition.gender,
            discipline: competition.discipline,
          }}
        />

        {/* Config panel: overrides over discipline defaults. */}
        <ActionForm action={updateCompetitionConfig} className={ui.card}>
          <h2 className="mb-1 font-medium">Scoring rules</h2>
          <p className="mb-4 text-xs text-score-dim">
            Blank / “default” = use the {competition.discipline} rule. Resolved
            values shown as placeholders.
          </p>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={ui.label} htmlFor="bestOf">
                Best of
              </label>
              <select
                id="bestOf"
                name="bestOf"
                defaultValue={configRow?.bestOf ?? ""}
                className={ui.select}
              >
                <option value="">Default ({resolved.bestOf})</option>
                {[1, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
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
                max={99}
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
                max={99}
                defaultValue={configRow?.setScoreTiebreak ?? ""}
                placeholder={String(resolved.setScoreTiebreak)}
                className={ui.input}
              />
            </div>
          </div>

          {PLAYERS_PER_SIDE[discipline] && (
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
                className={ui.select}
              >
                <option value="">Default ({resolved.playersPerSide})</option>
                {PLAYERS_PER_SIDE[discipline]!.map((nP) => (
                  <option key={nP} value={nP}>
                    {nP} players
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tri-state: empty = discipline default; a saved checkbox used to
              freeze the resolved value as a permanent override. */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className={ui.label} htmlFor="serveClockEnabled">
                Serve clock
              </label>
              <select
                id="serveClockEnabled"
                name="serveClockEnabled"
                defaultValue={triState(configRow?.serveClockEnabled)}
                className={ui.select}
              >
                <option value="">
                  Default ({resolved.serveClockEnabled ? "on" : "off"})
                </option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className={ui.label} htmlFor="ttoEnabled">
                Technical time-out
              </label>
              <select
                id="ttoEnabled"
                name="ttoEnabled"
                defaultValue={triState(configRow?.ttoEnabled)}
                className={ui.select}
              >
                <option value="">
                  Default ({resolved.ttoEnabled ? "on" : "off"})
                </option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <SubmitButton pendingLabel="Saving…">Save rules</SubmitButton>
          </div>
        </ActionForm>

        {/* Scoreboard appearance — per-competition broadcast-board theme. */}
        <ActionForm action={updateCompetitionBranding} className={ui.card}>
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
                  defaultValue={(boardBranding?.[key] as string | null) ?? dflt}
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
              className={ui.select}
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
              type="url"
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
        </ActionForm>
      </div>
    </main>
  );
}
