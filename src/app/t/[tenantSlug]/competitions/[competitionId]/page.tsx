import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  competitionCounts,
  getCompetition,
  getCompetitionConfig,
  listTenantMatches,
} from "@/lib/competitions";
import { computeStandings } from "@/lib/standings";
import { matchBase } from "@/lib/match-links";
import { LocalTime } from "@/components/LocalTime";
import { Page, Panel, StatRow, StatTile } from "@/components/ui/Page";
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
import { VCS_UI_ENABLED } from "@/lib/features";
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

/**
 * The tournament-config columns a competition can override, with the label used
 * when one is set. Everything absent from a competition's config row runs at
 * its discipline default and is not worth a line on the overview: the rules
 * card was ~1,000px of mostly-default inputs above the fold, which buried the
 * two or three values that actually differ from the book.
 */
const OVERRIDE_LABELS: { key: string; labelKey: string }[] = [
  { key: "bestOf", labelKey: "comp.bestOf" },
  { key: "setScore", labelKey: "comp.setScore" },
  { key: "setScoreTiebreak", labelKey: "comp.tiebreak" },
  { key: "playersPerSide", labelKey: "comp.playersPerSide" },
  { key: "serveClockEnabled", labelKey: "comp.serveClock" },
  { key: "ttoEnabled", labelKey: "comp.tto" },
  { key: "ttoDurationSecs", labelKey: "comp.ttoDuration" },
  { key: "resultSignatures", labelKey: "comp.resultSignatures" },
  { key: "sanctionAutoPoint", labelKey: "comp.sanctionAutoPoint" },
  // Listed only while challenges are actually offered — an override the
  // consoles ignore does not belong in the summary of what differs.
  ...(VCS_UI_ENABLED
    ? [
        { key: "vcsEnabled", labelKey: "comp.vcs" },
        { key: "vcsChallengesPerSet", labelKey: "comp.vcsPerSet" },
      ]
    : []),
  { key: "timeoutsPerSet", labelKey: "comp.timeouts" },
  { key: "timeoutsPerSetTiebreak", labelKey: "comp.timeoutsTiebreak" },
  { key: "timeoutDurationSecs", labelKey: "comp.timeoutDuration" },
  { key: "setBreakDurationsSecs", labelKey: "comp.setBreaks" },
];

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
  const [competition, configRow, counts, boardBranding, standings, upcoming] =
    await Promise.all([
      getCompetition(ctx.tenant.id, competitionId),
      getCompetitionConfig(competitionId),
      competitionCounts(competitionId),
      getCompetitionBranding(competitionId),
      computeStandings(competitionId),
      listTenantMatches(ctx.tenant.id, {
        competitionId,
        status: "scheduled",
        order: "asc",
      }),
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

  // Which rules actually differ from the discipline default.
  const cfg = (configRow ?? {}) as Record<string, unknown>;
  const overrides = OVERRIDE_LABELS.filter((o) => {
    const v = cfg[o.key];
    return v !== null && v !== undefined;
  }).map((o) => {
    const v = cfg[o.key];
    return {
      label: t(o.labelKey),
      value:
        typeof v === "boolean"
          ? t(v ? "common.on" : "common.off")
          : Array.isArray(v)
            ? v.join(" · ")
            : String(v),
    };
  });

  const leader = standings[0]?.rows[0] ?? null;
  const nextMatch = upcoming.rows[0] ?? null;
  const detailRows: [string, React.ReactNode][] = [
    [t("comp.venue"), competition.venue || "—"],
    [
      t("comp.cityCountry"),
      [competition.city, competition.country].filter(Boolean).join(" · ") || "—",
    ],
    [t("comp.hall"), competition.hall || "—"],
    [t("comp.category"), competition.category || "—"],
    [
      t("comp.dates"),
      competition.startDate
        ? `${competition.startDate}${competition.endDate ? ` → ${competition.endDate}` : ""}`
        : "—",
    ],
  ];

  return (
    <Page>
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="overview"
        subtitle={` · ${t("comp.teamsCount", { count: counts.teams })} · ${t("comp.matchesCount", { count: counts.matches })}`}
        actions={[
          <Link
            key="public"
            href={`/t/${tenantSlug}/results/${competitionId}`}
            className={ui.btnSecondary}
          >
            {t("comp.publicResults")} ↗
          </Link>,
          // Reverting to DRAFT lives in the danger zone at the foot of the page.
          ...(NEXT_STATUS[competition.status] ?? [])
            .filter((tr) => tr.to !== "DRAFT")
            .map((tr) => (
              <ActionForm
                key={tr.to}
                action={setCompetitionStatus}
                confirm={
                  STATUS_CONFIRM_KEY[tr.to]
                    ? t(STATUS_CONFIRM_KEY[tr.to]!)
                    : undefined
                }
              >
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="competitionId" value={competitionId} />
                <input type="hidden" name="status" value={tr.to} />
                <SubmitButton variant="primary">{tr.label}</SubmitButton>
              </ActionForm>
            )),
        ]}
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

      {/* Answer the standing questions first: who leads, what's next, how big
          is this. The forms below are for the rarer act of changing something. */}
      <StatRow>
        <StatTile
          label={t("comp.leader")}
          value={
            <span className="block truncate text-base">
              {leader?.teamName ?? "—"}
            </span>
          }
          hint={
            leader
              ? `${leader.w}-${leader.l} · ${leader.sw}:${leader.sl} ${t("comp.setsShort")}`
              : t("comp.noResultsYet")
          }
          href={`/t/${tenantSlug}/competitions/${competitionId}/standings`}
        />
        <StatTile
          label={t("comp.nextThrow")}
          value={
            <span className="block truncate text-base">
              {nextMatch?.scheduledAt ? (
                <LocalTime date={nextMatch.scheduledAt} />
              ) : (
                "—"
              )}
            </span>
          }
          hint={
            nextMatch
              ? `${nextMatch.teamAName} – ${nextMatch.teamBName}`
              : t("comp.nothingScheduled")
          }
          href={
            nextMatch
              ? matchBase(tenantSlug, nextMatch)
              : `/t/${tenantSlug}/competitions/${competitionId}/schedule`
          }
        />
        <StatTile
          label={t("comp.teams")}
          value={counts.teams}
          href={`/t/${tenantSlug}/competitions/${competitionId}/teams`}
        />
        <StatTile
          label={t("nav.matches")}
          value={counts.matches}
          href={`/t/${tenantSlug}/competitions/${competitionId}/schedule`}
        />
      </StatRow>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Panel
          title={t("comp.details")}
          actions={
            <span className="text-xs text-score-dim">
              {discipline} · {competition.gender ?? "—"}
            </span>
          }
        >
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            {detailRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-score-dim">{k}</dt>
                <dd className="truncate">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title={t("comp.standingsSnapshot")}
          actions={
            <Link
              href={`/t/${tenantSlug}/competitions/${competitionId}/standings`}
              className="text-xs text-score-dim hover:text-foreground"
            >
              {t("comp.fullStandings")} →
            </Link>
          }
        >
          {!standings[0] || standings[0].rows.length === 0 ? (
            <p className="text-sm text-score-dim">{t("comp.noResultsYet")}</p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {standings[0].rows.slice(0, 5).map((r, i) => (
                <li key={r.teamId} className="flex items-baseline gap-2">
                  <span className="w-4 text-right font-mono text-xs tabular-nums text-score-dim">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.teamName}</span>
                  <span className="font-mono text-xs tabular-nums">
                    {r.w}-{r.l}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-score-dim">
                    {r.sw}:{r.sl}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <details className="rounded-xl border border-border bg-surface-raised p-4 lg:col-span-2">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("comp.editDetails")}
            <span className="ml-2 font-normal text-score-dim">
              {t("comp.editDetailsHint")}
            </span>
          </summary>
          <div className="mt-3">
              <EditCompetitionForm
                tenantSlug={tenantSlug}
                competition={{
                  id: competition.id,
                  name: competition.name,
                  venue: competition.venue,
                  city: competition.city,
                  country: competition.country,
                  hall: competition.hall,
                  timezone: competition.timezone,
                  category: competition.category,
                  startDate: competition.startDate,
                  endDate: competition.endDate,
                  gender: competition.gender,
                  discipline: competition.discipline,
                  color: competition.color,
                }}
            />
          </div>
        </details>

        {/* Config panel: overrides over discipline defaults. Only the values
            that differ are shown up front; the full form is one click away. */}
        <ActionForm action={updateCompetitionConfig} className={ui.card}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{t("comp.scoringRules")}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                overrides.length > 0
                  ? "bg-primary/15 text-primary"
                  : "bg-surface-3 text-score-dim"
              }`}
            >
              {overrides.length > 0
                ? t("comp.overrideCount", { count: overrides.length })
                : t("comp.allDefaults")}
            </span>
          </div>
          <p className="mb-3 text-xs text-score-dim">
            {t("comp.rulesHint", { discipline: competition.discipline })}
          </p>

          {overrides.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-1.5">
              {overrides.map((o) => (
                <li
                  key={o.label}
                  className="rounded-lg border border-primary/40 px-2 py-1 text-xs"
                >
                  <span className="text-score-dim">{o.label}: </span>
                  {o.value}
                </li>
              ))}
            </ul>
          )}

          <details>
            <summary className="mb-3 cursor-pointer text-sm text-score-dim">
              {t("comp.showAllRules", { count: OVERRIDE_LABELS.length })}
            </summary>
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
            {/* Beach is scored without a serve clock — the beach console has no
                serve-clock widget, so the toggle is hidden rather than inert. */}
            {discipline !== "BEACH" && (
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
            )}
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
            {/* Obligation to sign the scoresheet after the match (spec/20).
                Offered for the disciplines whose consoles carry the signing
                flow — beach and indoor. */}
            {(discipline === "BEACH" || discipline === "INDOOR") && (
              <div>
                <label className={ui.label} htmlFor="resultSignatures">
                  {t("comp.resultSignatures")}
                </label>
                <select
                  id="resultSignatures"
                  name="resultSignatures"
                  defaultValue={configRow?.resultSignatures ?? ""}
                  className={ui.select}
                >
                  <option value="">
                    {t("common.default", {
                      value: t(`comp.sig.${resolved.resultSignatures}`),
                    })}
                  </option>
                  <option value="REQUIRED">{t("comp.sig.REQUIRED")}</option>
                  <option value="OPTIONAL">{t("comp.sig.OPTIONAL")}</option>
                  <option value="OFF">{t("comp.sig.OFF")}</option>
                </select>
              </div>
            )}
            {/* What the console does about the point a penalty awards
                (spec/29 F14). Recording is fact-only either way — this only
                decides how much help the scorer gets in not forgetting the
                consequence. */}
            <div>
              <label className={ui.label} htmlFor="sanctionAutoPoint">
                {t("comp.sanctionAutoPoint")}
              </label>
              <select
                id="sanctionAutoPoint"
                name="sanctionAutoPoint"
                defaultValue={configRow?.sanctionAutoPoint ?? ""}
                className={ui.select}
              >
                <option value="">
                  {t("common.default", {
                    value: t(`comp.autoPoint.${resolved.sanctionAutoPoint}`),
                  })}
                </option>
                <option value="PROMPT">{t("comp.autoPoint.PROMPT")}</option>
                <option value="AUTO">{t("comp.autoPoint.AUTO")}</option>
                <option value="OFF">{t("comp.autoPoint.OFF")}</option>
              </select>
            </div>
            {/* TTO length — drives the countdown on the scorer console and the
                public board. FIVB beach default is 30 s (rule 15.4.2); a
                different length needs FIVB approval for official events. */}
            <div>
              <label className={ui.label} htmlFor="ttoDurationSecs">
                {t("comp.ttoDuration")}
              </label>
              <input
                id="ttoDurationSecs"
                name="ttoDurationSecs"
                type="number"
                min={5}
                max={600}
                defaultValue={configRow?.ttoDurationSecs ?? ""}
                placeholder={String(resolved.ttoDurationSecs)}
                className={ui.input}
              />
            </div>
          </div>

          {/* Challenges (Video Challenge System). Hidden while the request
              buttons are ([[VCS_UI_ENABLED]]) — a switch that reaches no
              button is worse than no switch. Whatever the competition already
              stored rides along in hidden fields, so saving anything else here
              does not silently clear it. */}
          {VCS_UI_ENABLED ? (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className={ui.label} htmlFor="vcsEnabled">
                  {t("comp.vcs")}
                </label>
                <select
                  id="vcsEnabled"
                  name="vcsEnabled"
                  defaultValue={triState(configRow?.vcsEnabled)}
                  className={ui.select}
                >
                  <option value="">
                    {t("common.default", { value: resolved.vcsEnabled ? "on" : "off" })}
                  </option>
                  <option value="on">{t("common.on")}</option>
                  <option value="off">{t("common.off")}</option>
                </select>
              </div>
              <div>
                <label className={ui.label} htmlFor="vcsChallengesPerSet">
                  {t("comp.vcsPerSet")}
                </label>
                <input
                  id="vcsChallengesPerSet"
                  name="vcsChallengesPerSet"
                  type="number"
                  min={0}
                  max={9}
                  defaultValue={configRow?.vcsChallengesPerSet ?? ""}
                  placeholder={String(resolved.vcsChallengesPerSet)}
                  className={ui.input}
                />
              </div>
            </div>
          ) : (
            <>
              <input type="hidden" name="vcsEnabled" value={triState(configRow?.vcsEnabled)} />
              <input
                type="hidden"
                name="vcsChallengesPerSet"
                value={configRow?.vcsChallengesPerSet ?? ""}
              />
            </>
          )}

          {/* Time-outs */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label className={ui.label} htmlFor="timeoutsPerSet">
                {t("comp.timeouts")}
              </label>
              <input
                id="timeoutsPerSet"
                name="timeoutsPerSet"
                type="number"
                min={0}
                max={9}
                defaultValue={configRow?.timeoutsPerSet ?? ""}
                placeholder={String(resolved.timeoutsPerSet)}
                className={ui.input}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="timeoutsPerSetTiebreak">
                {t("comp.timeoutsTiebreak")}
              </label>
              <input
                id="timeoutsPerSetTiebreak"
                name="timeoutsPerSetTiebreak"
                type="number"
                min={0}
                max={9}
                defaultValue={configRow?.timeoutsPerSetTiebreak ?? ""}
                placeholder={String(resolved.timeoutsPerSetTiebreak)}
                className={ui.input}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="timeoutDurationSecs">
                {t("comp.timeoutDuration")}
              </label>
              <input
                id="timeoutDurationSecs"
                name="timeoutDurationSecs"
                type="number"
                min={5}
                max={600}
                defaultValue={configRow?.timeoutDurationSecs ?? ""}
                placeholder={String(resolved.timeoutDurationSecs)}
                className={ui.input}
              />
            </div>
          </div>

          {/* Per-break set-break durations (seconds). One input per break. */}
          {resolved.bestOf > 1 && (
            <div className="mt-4">
              <label className={ui.label}>{t("comp.setBreaks")}</label>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: resolved.bestOf - 1 }).map((_, i) => (
                  <div key={i}>
                    <span className="mb-1 block text-xs text-score-dim">
                      {t("comp.afterSet", { n: i + 1 })}
                    </span>
                    <input
                      name={`setBreak_${i + 1}`}
                      type="number"
                      min={0}
                      max={3600}
                      defaultValue={configRow?.setBreakDurationsSecs?.[i] ?? ""}
                      placeholder={String(
                        resolved.setBreakDurationsSecs[i] ??
                          resolved.setBreakDurationsSecs[
                            resolved.setBreakDurationsSecs.length - 1
                          ] ??
                          60,
                      )}
                      className={ui.input}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

            <div className="mt-4">
              <SubmitButton pendingLabel={t("common.saving")}>
                {t("comp.saveRules")}
              </SubmitButton>
            </div>
          </details>
        </ActionForm>

        {/* Scoreboard appearance — per-competition broadcast-board theme.
            Almost always left at the tenant's colours, so it starts collapsed. */}
        <ActionForm action={updateCompetitionBranding} className={ui.card}>
          <h2 className="mb-1 font-medium">{t("comp.scoreboard")}</h2>
          <p className="mb-3 text-[11px] text-score-dim">
            {t("comp.scoreboardHint")}
          </p>
          <details>
            <summary className="mb-3 cursor-pointer text-sm text-score-dim">
              {t("comp.customise")}
            </summary>
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
          <div className="mt-3">
            <label className={ui.label} htmlFor="board-bg">
              {t("comp.boardBgUrl")}
            </label>
            <input
              id="board-bg"
              name="boardBgUrl"
              defaultValue={boardBranding?.boardBgUrl ?? ""}
              placeholder="https://…/artwork.jpg  or  /board-bg/avc-cup-pattern.png"
              className={ui.input}
            />
            <p className="mt-1 text-[11px] text-score-dim">
              {t("comp.boardBgUrlHint")}
            </p>
          </div>
            <div className="mt-4">
              <SubmitButton variant="secondary" pendingLabel={t("common.saving")}>
                {t("comp.saveScoreboard")}
              </SubmitButton>
            </div>
          </details>
        </ActionForm>
      </div>

      {/* Lifecycle reversal is destructive to a published competition (its
          public results disappear), so it gets its own marked-out area rather
          than sitting next to Save. */}
      {(NEXT_STATUS[competition.status] ?? []).some((tr) => tr.to === "DRAFT") && (
        <section className="mt-6 rounded-xl border border-danger/40 p-4">
          <h2 className="text-sm font-semibold text-danger">
            {t("comp.dangerZone")}
          </h2>
          <p className="mt-1 mb-3 text-xs text-score-dim">
            {t("comp.dangerHint")}
          </p>
          {(NEXT_STATUS[competition.status] ?? [])
            .filter((tr) => tr.to === "DRAFT")
            .map((tr) => (
              <ActionForm
                key={tr.to}
                action={setCompetitionStatus}
                confirm={t("comp.backToDraftConfirm")}
              >
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="competitionId" value={competitionId} />
                <input type="hidden" name="status" value={tr.to} />
                <SubmitButton variant="secondary">{tr.label}</SubmitButton>
              </ActionForm>
            ))}
        </section>
      )}
    </Page>
  );
}
