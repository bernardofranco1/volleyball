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
  updateMatchRound,
  updateMatchSlots,
} from "@/lib/schedule-actions";
import { importSchedule } from "@/lib/csv-actions";
import { getT } from "@/lib/i18n/server";
import { toUtcInputValue } from "@/lib/form-data";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddMatchForm } from "@/components/admin/AddMatchForm";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { CsvImport } from "@/components/admin/CsvImport";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { LocalDateTimeInput } from "@/components/ui/LocalDateTimeInput";
import { Page } from "@/components/ui/Page";
import { BatchEditForm } from "@/components/ui/SaveBar";
import { Toolbar, ToolbarSpacer } from "@/components/ui/Toolbar";
import { matchStatusLabel, statusBadgeClass, ui } from "@/components/admin/styles";

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
  const { t } = await getT();
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

  // Group by round: a league season is read a round at a time, and the round is
  // the unit people reschedule.
  const groups = new Map<string, MatchRow[]>();
  for (const m of matchList) {
    const key = m.roundName ?? t("schedule.unassignedRound");
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const roundNames = [...groups.keys()];

  const inputCls =
    "rounded-md border border-border-strong bg-surface px-2 py-1 text-sm outline-none focus:border-primary";

  const columns: Column<MatchRow>[] = [
    {
      key: "num",
      header: "#",
      width: "w-10",
      className: "font-mono tabular-nums text-xs text-score-dim",
      cell: (m) => m.matchNumber ?? "–",
    },
    {
      key: "match",
      header: t("nav.matches"),
      cell: (m) => (
        <Link href={`${base}/matches/${m.id}`} className="font-medium">
          {m.teamAName} <span className="text-score-dim">–</span> {m.teamBName}
        </Link>
      ),
    },
    {
      key: "court",
      header: t("common.court"),
      width: "w-20",
      cell: (m) => (
        <input
          type="number"
          min={1}
          name={`court:${m.id}`}
          defaultValue={m.courtNumber ?? ""}
          data-row={m.id}
          data-field="court"
          aria-label={`${t("common.court")} — ${m.teamAName} / ${m.teamBName}`}
          className={`${inputCls} w-14`}
        />
      ),
    },
    {
      key: "time",
      header: t("schedule.localTime"),
      width: "w-60",
      cell: (m) => (
        <LocalDateTimeInput
          name={`time:${m.id}`}
          utcValue={toUtcInputValue(m.scheduledAt)}
          row={m.id}
          ariaLabel={`${t("schedule.localTime")} — ${m.teamAName} / ${m.teamBName}`}
          className={`${inputCls} w-56`}
        />
      ),
    },
    {
      key: "result",
      header: t("common.result"),
      align: "right",
      width: "w-16",
      className: "font-mono tabular-nums",
      cell: (m) =>
        m.setsWonA > 0 || m.setsWonB > 0 ? (
          <>
            {m.setsWonA}–{m.setsWonB}
          </>
        ) : (
          <span className="text-score-dim">—</span>
        ),
    },
    {
      key: "status",
      header: t("common.status"),
      width: "w-24",
      cell: (m) => (
        <span className={statusBadgeClass(m.status)}>
          {matchStatusLabel(m.status, t("match.pendingBadge"))}
        </span>
      ),
    },
    {
      key: "row-actions",
      header: "",
      align: "right",
      width: "w-24",
      cell: (m) => (
        <span className="flex justify-end gap-2 text-xs text-score-dim">
          <Link href={`${base}/matches/${m.id}`} className="hover:text-foreground">
            {t("schedule.details")}
          </Link>
        </span>
      ),
    },
  ];

  return (
    <Page>
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="schedule"
        subtitle={` · ${t("comp.matchesCount", { count: matchList.length })}`}
      />

      <div className="mb-3">
        <Toolbar>
          <span className="text-sm text-score-dim">
            {matchList.length === 1
              ? t("schedule.oneMatch")
              : t("comp.matchesCount", { count: matchList.length })}
          </span>
          <ToolbarSpacer />
          {/* Create surfaces open on demand — the permanent 320px rail these
              replace was in use for a few seconds a week. */}
          <Drawer label={t("schedule.addMatch")} variant="primary">
            <AddMatchForm
              tenantSlug={tenantSlug}
              competitionId={competitionId}
              teams={teams.map((tm) => ({
                id: tm.id,
                displayName: tm.displayName,
              }))}
            />
          </Drawer>
          {teams.length >= 2 && (
            <ActionForm
              action={generateRoundRobin}
              confirm={t("schedule.generateConfirm")}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="competitionId" value={competitionId} />
              <SubmitButton
                variant="secondary"
                pendingLabel={t("common.generating")}
              >
                {t("schedule.generate")}
              </SubmitButton>
            </ActionForm>
          )}
          <Drawer label={t("schedule.importTitle")} width="lg">
            <CsvImport
              tenantSlug={tenantSlug}
              competitionId={competitionId}
              title={t("schedule.importTitle")}
              hint="Match number,Team A,Team B,Court number,Group,Phase number,Phase name,Match day,Match time (local)"
              action={importSchedule}
              templateHref={SCHEDULE_TEMPLATE}
              templateName="schedule-template.csv"
            />
          </Drawer>
        </Toolbar>
      </div>

      {matchList.length === 0 ? (
        <div className={`${ui.card} text-sm text-score-dim`}>
          {t("schedule.empty")}
        </div>
      ) : (
        <BatchEditForm
          action={updateMatchSlots}
          rowLabels={Object.fromEntries(
            matchList.map((m) => [m.id, `#${m.matchNumber ?? "–"}`]),
          )}
          fieldLabels={{
            court: t("common.court").toLowerCase(),
            time: t("schedule.localTime").toLowerCase(),
          }}
          strings={{
            // Interpolated in the client component, so the placeholder survives.
            unsaved: t("schedule.unsaved", { count: "{count}" }),
            save: t("schedule.saveAll"),
            saving: t("common.saving"),
            discard: t("common.discard"),
            saved: t("common.saved"),
          }}
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="competitionId" value={competitionId} />
          <DataTable
            columns={columns}
            rowKey={(m) => m.id}
            density="compact"
            groups={[...groups.entries()].map(([roundName, ms]) => ({
              key: roundName,
              label: (
                <span>
                  {roundName}
                  <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
                    {ms.length === 1
                      ? t("schedule.oneMatch")
                      : t("comp.matchesCount", { count: ms.length })}
                    {ms.every((m) => m.status === "FINISHED")
                      ? t("schedule.finishedSuffix")
                      : ""}
                  </span>
                </span>
              ),
              rows: ms,
            }))}
          />
        </BatchEditForm>
      )}

      {/* Round membership and deletion are rare, destructive-ish edits, so they
          sit outside the batch table rather than adding two more columns. */}
      {matchList.length > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-surface-raised p-4">
          <summary className="cursor-pointer text-sm font-medium text-score-dim">
            {t("schedule.moreEdits")}
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {matchList.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2.5"
              >
                <span className="min-w-0 flex-1 text-sm">
                  <span className="text-xs text-score-dim">
                    #{m.matchNumber ?? "–"}{" "}
                  </span>
                  {m.teamAName} – {m.teamBName}
                </span>
                <ActionForm
                  action={updateMatchRound}
                  className="flex items-end gap-1.5"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input
                    type="hidden"
                    name="competitionId"
                    value={competitionId}
                  />
                  <input type="hidden" name="matchId" value={m.id} />
                  <input
                    name="roundName"
                    list="round-names"
                    defaultValue={m.roundName ?? ""}
                    aria-label={t("common.round")}
                    className={`${inputCls} w-32`}
                  />
                  <SubmitButton variant="secondary" pendingLabel="…">
                    {t("common.save")}
                  </SubmitButton>
                </ActionForm>
                {m.status === "SCHEDULED" && (
                  <ActionForm
                    action={deleteMatch}
                    confirm={t("schedule.deleteConfirm", {
                      number: m.matchNumber ?? "",
                      teamA: m.teamAName,
                      teamB: m.teamBName,
                    })}
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input
                      type="hidden"
                      name="competitionId"
                      value={competitionId}
                    />
                    <input type="hidden" name="matchId" value={m.id} />
                    <button
                      type="submit"
                      className="px-1 text-xs text-score-dim hover:text-danger"
                    >
                      {t("schedule.deleteMatch")}
                    </button>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
          <datalist id="round-names">
            {roundNames.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </details>
      )}
    </Page>
  );
}
