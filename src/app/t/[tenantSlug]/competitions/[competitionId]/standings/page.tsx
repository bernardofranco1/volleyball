import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { computeStandings, fmtRatio } from "@/lib/standings";
import { listPoolsWithTeams, loadBracket } from "@/lib/tournament";
import {
  advanceBracket,
  assignTeamPool,
  createPool,
  generateBracket,
} from "@/lib/tournament-actions";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
import { BracketView } from "@/components/admin/BracketView";
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
  const competition = await getCompetition(ctx.tenant.id, competitionId);
  if (!competition) notFound();

  const [groups, { pools, teams }, bracket] = await Promise.all([
    computeStandings(competitionId),
    listPoolsWithTeams(competitionId),
    loadBracket(competitionId),
  ]);
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;
  const hidden = (
    <>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
    </>
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{competition.name}</h1>
          <p className="mt-1 text-sm text-score-dim">Standings &amp; bracket</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/t/${tenantSlug}/results/${competitionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={ui.btnSecondary}
          >
            Public results ↗
          </a>
          <a
            href={`/api/competitions/${competitionId}/results.csv`}
            className={ui.btnSecondary}
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="mt-6">
        <CompetitionTabs tenantSlug={tenantSlug} competitionId={competitionId} active="standings" />
      </div>

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
            Tiebreakers: wins → set ratio → point ratio → head-to-head.
          </p>
        </div>
      )}

      {/* Pools */}
      <section className="mt-10">
        <h2 className="mb-3 font-medium">Pools</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className={ui.card}>
            {teams.length === 0 ? (
              <p className="text-sm text-score-dim">Add teams first.</p>
            ) : (
              <ul className="space-y-2">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{t.displayName}</span>
                    <form action={assignTeamPool} className="flex items-center gap-2">
                      {hidden}
                      <input type="hidden" name="teamId" value={t.id} />
                      <select
                        name="poolId"
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
                      <SubmitButton variant="secondary" pendingLabel="…">
                        Set
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form action={createPool} className={ui.card}>
            <h3 className="mb-3 font-medium">New pool</h3>
            {hidden}
            <input
              name="name"
              required
              placeholder="Pool A"
              className={ui.input}
            />
            <div className="mt-3">
              <SubmitButton pendingLabel="Adding…">Create pool</SubmitButton>
            </div>
          </form>
        </div>
      </section>

      {/* Knockout bracket */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Knockout bracket</h2>
          <div className="flex gap-2">
            {bracket.length === 0 ? (
              <form action={generateBracket}>
                {hidden}
                <SubmitButton pendingLabel="Seeding…">
                  Generate (single-elim)
                </SubmitButton>
              </form>
            ) : (
              <form action={advanceBracket}>
                {hidden}
                <SubmitButton variant="secondary" pendingLabel="Advancing…">
                  Advance winners
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
        <div className={ui.card}>
          <BracketView rounds={bracket} matchHref={(id) => `${base}/matches/${id}`} />
        </div>
        <p className="mt-2 text-xs text-score-dim">
          Seeds by team seed (largest power-of-two field). Play each round, then
          “Advance winners” to stage the next; the 3rd-place match is created with
          the final.
        </p>
      </section>
    </main>
  );
}
