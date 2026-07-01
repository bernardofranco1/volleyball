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
} from "@/lib/tournament-actions";
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
          No teams yet — standings appear once matches finish.
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
                      <th className={ui.th}>Team</th>
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
            Tiebreakers: wins → set ratio → point ratio → head-to-head. Pool
            tables count intra-pool matches only.
          </p>
        </div>
      )}

      {/* Pools */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Pools</h2>
          {pools.length >= 2 && teams.length > 0 && (
            <ActionForm
              action={distributePoolsBySeed}
              confirm={`Distribute all ${teams.length} teams into ${pools.length} pools by seed (serpentine)? Existing assignments are overwritten.`}
            >
              {hidden}
              <SubmitButton variant="secondary" pendingLabel="Distributing…">
                Distribute by seed
              </SubmitButton>
            </ActionForm>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className={ui.card}>
            {teams.length === 0 ? (
              <p className="text-sm text-score-dim">Add teams first.</p>
            ) : (
              <ActionForm action={savePoolAssignments}>
                {hidden}
                <ul className="space-y-2">
                  {teams.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <label
                        htmlFor={`pool-${t.id}`}
                        className="text-sm"
                      >
                        {t.displayName}
                      </label>
                      <select
                        id={`pool-${t.id}`}
                        name={`pool-${t.id}`}
                        defaultValue={t.poolId ?? ""}
                        className={`${ui.select} w-40`}
                      >
                        <option value="">— no pool —</option>
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
                  <SubmitButton pendingLabel="Saving…">
                    Save all assignments
                  </SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>

          <div className="space-y-4">
            <ActionForm action={createPool} className={ui.card} resetOnOk>
              <h3 className="mb-3 font-medium">New pool</h3>
              {hidden}
              <label className="sr-only" htmlFor="new-pool-name">
                Pool name
              </label>
              <input
                id="new-pool-name"
                name="name"
                required
                placeholder="Pool A"
                className={ui.input}
              />
              <div className="mt-3">
                <SubmitButton pendingLabel="Adding…">Create pool</SubmitButton>
              </div>
            </ActionForm>

            {pools.length > 0 && (
              <div className={ui.card}>
                <h3 className="mb-3 font-medium">Manage pools</h3>
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
                          Rename {p.name}
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
                          Rename
                        </button>
                      </ActionForm>
                      <ActionForm
                        action={deletePool}
                        confirm={`Delete ${p.name}? Its teams become unpooled.`}
                        className="mt-1"
                      >
                        {hidden}
                        <input type="hidden" name="poolId" value={p.id} />
                        <button
                          type="submit"
                          className="text-xs text-score-dim hover:text-red-400"
                        >
                          Delete pool
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
          With pools assigned, “Generate round-robin” on the Schedule tab
          creates per-pool fixtures, and each pool&apos;s table counts only its own
          matches.
        </p>
      </section>

      {/* Knockout bracket */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Knockout bracket</h2>
          <div className="flex gap-2">
            {bracket.length === 0 ? (
              <ActionForm
                action={generateBracket}
                confirm="Seed the bracket from the Seed column now? This creates the first-round matches."
              >
                {hidden}
                <SubmitButton pendingLabel="Seeding…">
                  Generate (single-elim)
                </SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm
                action={advanceBracket}
                confirm="Advance winners into the next round?"
              >
                {hidden}
                <SubmitButton variant="secondary" pendingLabel="Advancing…">
                  Advance winners
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
        <div className={ui.card}>
          <BracketView rounds={bracket} matchHref={(id) => `${base}/matches/${id}`} />
        </div>
        <p className="mt-2 text-xs text-score-dim">
          Seeds come from the teams&apos; Seed column (largest power-of-two field) —
          update seeds after pool play before generating. Play each round, then
          “Advance winners” to stage the next; the 3rd-place match is created
          with the final.
        </p>
      </section>
    </main>
  );
}
