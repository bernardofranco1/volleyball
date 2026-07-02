import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { computeStandings, fmtRatio } from "@/lib/standings";
import { listPoolsWithTeams, loadBracket } from "@/lib/tournament";
import {
  advanceBracket,
  createPool,
  deletePool,
  distributePoolsBySeed,
  generateBracket,
  renamePool,
  savePoolAssignments,
  seedFromStandings,
} from "@/lib/tournament-actions";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { BracketView } from "@/components/admin/BracketView";
import { CompetitionHeader } from "@/components/admin/CompetitionHeader";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const COLS = [
  ["MP", "mp"],
  ["W", "w"],
  ["L", "l"],
  ["SW", "sw"],
  ["SL", "sl"],
  ["PW", "pw"],
  ["PL", "pl"],
] as const;

export default async function StandingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const { t } = await getT();
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/standings`,
  );
  const [competition, groups, { pools, teams }, bracket] = await Promise.all([
    getCompetition(ctx.tenant.id, competitionId),
    computeStandings(competitionId),
    listPoolsWithTeams(competitionId),
    loadBracket(competitionId),
  ]);
  if (!competition) notFound();

  const base = `/t/${tenantSlug}/competitions/${competitionId}`;
  const hidden = (
    <>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
    </>
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <CompetitionHeader
        tenantSlug={tenantSlug}
        competition={competition}
        active="standings"
      />

      {/* Standings */}
      {groups.length === 0 || groups.every((g) => g.rows.length === 0) ? (
        <div className={`${ui.card} text-sm text-score-dim`}>
          {t("standings.empty")}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.name}>
              <h2 className="mb-2 font-medium">{group.name}</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse">
                  <thead className="bg-surface-raised">
                    <tr>
                      <th className={ui.th}>#</th>
                      <th className={ui.th}>{t("common.team")}</th>
                      {COLS.map(([label]) => (
                        <th key={label} className={`${ui.th} text-right`}>
                          {label}
                        </th>
                      ))}
                      <th className={`${ui.th} text-right`}>SR</th>
                      <th className={`${ui.th} text-right`}>PR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((r, i) => (
                      <tr key={r.teamId} className="border-t border-border">
                        <td className={`${ui.td} text-score-dim`}>{i + 1}</td>
                        <td className={`${ui.td} font-medium`}>{r.teamName}</td>
                        {COLS.map(([label, field]) => (
                          <td key={label} className={`${ui.td} text-right tabular-nums`}>
                            {r[field]}
                          </td>
                        ))}
                        <td className={`${ui.td} text-right tabular-nums`}>{fmtRatio(r.srNum)}</td>
                        <td className={`${ui.td} text-right tabular-nums`}>{fmtRatio(r.prNum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="text-xs text-score-dim">
            {t("standings.tiebreakers")}
          </p>
        </div>
      )}

      {/* Pools */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{t("standings.pools")}</h2>
          {pools.length >= 2 && teams.length > 0 && (
            <ActionForm
              action={distributePoolsBySeed}
              confirm={t("standings.distributeConfirm", {
                teams: teams.length,
                pools: pools.length,
              })}
            >
              {hidden}
              <SubmitButton variant="secondary" pendingLabel={t("standings.distributing")}>
                {t("standings.distribute")}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className={ui.card}>
            {teams.length === 0 ? (
              <p className="text-sm text-score-dim">{t("standings.addTeamsFirst")}</p>
            ) : (
              <ActionForm action={savePoolAssignments}>
                {hidden}
                <ul className="space-y-2">
                  {teams.map((team) => (
                    <li
                      key={team.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <label
                        htmlFor={`pool-${team.id}`}
                        className="text-sm"
                      >
                        {team.displayName}
                      </label>
                      <select
                        id={`pool-${team.id}`}
                        name={`pool-${team.id}`}
                        defaultValue={team.poolId ?? ""}
                        className={`${ui.select} w-40`}
                      >
                        <option value="">{t("standings.noPool")}</option>
                        {pools.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <SubmitButton pendingLabel={t("common.saving")}>
                    {t("standings.saveAssignments")}
                  </SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>

          <div className="space-y-4">
            <ActionForm action={createPool} className={ui.card} resetOnOk>
              <h3 className="mb-3 font-medium">{t("standings.newPool")}</h3>
              {hidden}
              <label className="sr-only" htmlFor="new-pool-name">
                {t("standings.poolName")}
              </label>
              <input
                id="new-pool-name"
                name="name"
                required
                placeholder="Pool A"
                className={ui.input}
              />
              <div className="mt-3">
                <SubmitButton pendingLabel={t("common.adding")}>{t("standings.createPool")}</SubmitButton>
              </div>
            </ActionForm>

            {pools.length > 0 && (
              <div className={ui.card}>
                <h3 className="mb-3 font-medium">{t("standings.managePools")}</h3>
                <ul className="space-y-3">
                  {pools.map((p) => (
                    <li key={p.id}>
                      <ActionForm
                        action={renamePool}
                        className="flex items-center gap-2"
                      >
                        {hidden}
                        <input type="hidden" name="poolId" value={p.id} />
                        <label className="sr-only" htmlFor={`rename-${p.id}`}>
                          {t("standings.renameLabel", { name: p.name })}
                        </label>
                        <input
                          id={`rename-${p.id}`}
                          name="name"
                          defaultValue={p.name}
                          className={`${ui.input} flex-1 px-2 py-1 text-sm`}
                        />
                        <button
                          type="submit"
                          className="text-xs text-score-dim hover:text-foreground"
                        >
                          {t("common.rename")}
                        </button>
                      </ActionForm>
                      <ActionForm
                        action={deletePool}
                        confirm={t("standings.deletePoolConfirm", { name: p.name })}
                        className="mt-1"
                      >
                        {hidden}
                        <input type="hidden" name="poolId" value={p.id} />
                        <button
                          type="submit"
                          className="text-xs text-score-dim hover:text-red-400"
                        >
                          {t("standings.deletePool")}
                        </button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-score-dim">
          {t("standings.poolsNote")}
        </p>
      </section>

      {/* Knockout bracket */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">{t("standings.bracket")}</h2>
          <div className="flex gap-2">
            {bracket.length === 0 ? (
              <>
                <ActionForm
                  action={seedFromStandings}
                  confirm={t("standings.seedConfirm")}
                >
                  {hidden}
                  <SubmitButton variant="secondary" pendingLabel={t("standings.seeding")}>
                    {t("standings.seedFrom")}
                  </SubmitButton>
                </ActionForm>
                <ActionForm
                  action={generateBracket}
                  confirm={t("standings.generateBracketConfirm")}
                >
                  {hidden}
                  <SubmitButton pendingLabel={t("standings.seeding")}>
                    {t("standings.generateBracket")}
                  </SubmitButton>
                </ActionForm>
              </>
            ) : (
              <ActionForm
                action={advanceBracket}
                confirm={t("standings.advanceConfirm")}
              >
                {hidden}
                <SubmitButton variant="secondary" pendingLabel={t("standings.advancing")}>
                  {t("standings.advance")}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
        <div className={ui.card}>
          <BracketView rounds={bracket} matchHref={(id) => `${base}/matches/${id}`} />
        </div>
        <p className="mt-2 text-xs text-score-dim">
          {t("standings.bracketNote")}
        </p>
      </section>
    </main>
  );
}
