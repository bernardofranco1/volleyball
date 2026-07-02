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
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { EditCompetitionForm } from "@/components/admin/EditCompetitionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// Confirm-message keys per target status (resolved through the dictionary).
const STATUS_CONFIRM_KEY: Record<string, string | undefined> = {
  FINISHED: "comp.finishConfirm",
  ACTIVE: undefined,
  DRAFT: undefined,
};

export default async function CompetitionOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const { t } = await getT();
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
        subtitle={` · ${t("comp.teamsCount", { count: counts.teams })} · ${t("comp.matchesCount", { count: counts.matches })}`}
        actions={(NEXT_STATUS[competition.status] ?? []).map((tr) => (
          <ActionForm
            key={tr.to}
            action={setCompetitionStatus}
            confirm={
              STATUS_CONFIRM_KEY[tr.to] ? t(STATUS_CONFIRM_KEY[tr.to]!) : undefined
            }
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <input type="hidden" name="status" value={tr.to} />
            <SubmitButton variant={tr.to === "DRAFT" ? "secondary" : "primary"}>
              {tr.label}
            </SubmitButton>
          </ActionForm>
        ))}
      />

      {competition.status === "DRAFT" && (
        <div className={`${ui.card} mb-6`}>
          <h2 className="mb-2 font-medium">{t("comp.checklistTitle")}</h2>
          <ol className="space-y-1 text-sm">
            {(
              [
                [
                  counts.teams >= 2,
                  <>{t("comp.check1Pre")}<a className="underline hover:text-foreground" href={`/t/${tenantSlug}/competitions/${competitionId}/teams`}>{t("comp.check1Link")}</a>{t("comp.check1Post")}</>,
                ],
                [
                  false,
                  <>{t("comp.check2Pre")}<a className="underline hover:text-foreground" href={`/t/${tenantSlug}/competitions/${competitionId}/standings`}>{t("comp.check2Link")}</a>{t("comp.check2Post")}</>,
                ],
                [
                  counts.matches > 0,
                  <>{t("comp.check3Pre")}<a className="underline hover:text-foreground" href={`/t/${tenantSlug}/competitions/${competitionId}/schedule`}>{t("comp.check3Link")}</a>{t("comp.check3Post")}</>,
                ],
                [false, <>{t("comp.check4")}</>],
              ] as const
            ).map(([done, label], i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={done ? "text-emerald-400" : "text-score-dim"} aria-hidden>
                  {done ? "✓" : "○"}
                </span>
                <span className={done ? "text-score-dim line-through" : undefined}>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

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
          <h2 className="mb-1 font-medium">{t("comp.scoringRules")}</h2>
          <p className="mb-4 text-xs text-score-dim">
            {t("comp.rulesHint", { discipline: competition.discipline })}
          </p>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={ui.label} htmlFor="bestOf">
                {t("comp.bestOf")}
              </label>
              <select
                id="bestOf"
                name="bestOf"
                defaultValue={configRow?.bestOf ?? ""}
                className={ui.select}
              >
                <option value="">{t("common.default", { value: resolved.bestOf })}</option>
                {[1, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ui.label} htmlFor="setScore">
                {t("comp.setScore")}
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
                {t("comp.tiebreak")}
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
                {t("comp.playersPerSide")}{" "}
                <span className="font-normal text-score-dim">
                  {t("comp.playersPerSideHint")}
                </span>
              </label>
              <select
                id="playersPerSide"
                name="playersPerSide"
                defaultValue={configRow?.playersPerSide ?? ""}
                className={ui.select}
              >
                <option value="">{t("common.default", { value: resolved.playersPerSide })}</option>
                {PLAYERS_PER_SIDE[discipline]!.map((nP) => (
                  <option key={nP} value={nP}>
                    {t("comp.nPlayers", { count: nP })}
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
                {t("comp.serveClock")}
              </label>
              <select
                id="serveClockEnabled"
                name="serveClockEnabled"
                defaultValue={triState(configRow?.serveClockEnabled)}
                className={ui.select}
              >
                <option value="">
                  {t("common.default", { value: resolved.serveClockEnabled ? "on" : "off" })}
                </option>
                <option value="on">{t("common.on")}</option>
                <option value="off">{t("common.off")}</option>
              </select>
            </div>
            <div>
              <label className={ui.label} htmlFor="ttoEnabled">
                {t("comp.tto")}
              </label>
              <select
                id="ttoEnabled"
                name="ttoEnabled"
                defaultValue={triState(configRow?.ttoEnabled)}
                className={ui.select}
              >
                <option value="">
                  {t("common.default", { value: resolved.ttoEnabled ? "on" : "off" })}
                </option>
                <option value="on">{t("common.on")}</option>
                <option value="off">{t("common.off")}</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <SubmitButton pendingLabel={t("common.saving")}>{t("comp.saveRules")}</SubmitButton>
          </div>
        </ActionForm>

        {/* Scoreboard appearance — per-competition broadcast-board theme. */}
        <ActionForm action={updateCompetitionBranding} className={ui.card}>
          <h2 className="mb-1 font-medium">{t("comp.scoreboard")}</h2>
          <p className="mb-3 text-[11px] text-score-dim">
            {t("comp.scoreboardHint")}
          </p>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["bgColor", t("comp.background"), boardDefault.bg],
                ["lineColor", t("comp.lines"), boardDefault.line],
                ["accentColor", t("comp.accent"), boardDefault.accent],
                ["fontColor", t("comp.text"), boardDefault.font],
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
              {t("settings.fontFamily")}
            </label>
            <select
              id="board-font"
              name="fontFamily"
              defaultValue={boardBranding?.fontFamily ?? ""}
              className={ui.select}
            >
              <option value="">{t("comp.defaultFont")}</option>
              {BOARD_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3">
            <label className={ui.label} htmlFor="board-logo">
              {t("comp.logoUrl")}
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
            <SubmitButton variant="secondary" pendingLabel={t("common.saving")}>
              {t("comp.saveScoreboard")}
            </SubmitButton>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
