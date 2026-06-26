import { notFound } from "next/navigation";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import { getCompetition } from "@/lib/competitions";
import { computeStandings, fmtRatio } from "@/lib/standings";
import { CompetitionTabs } from "@/components/admin/CompetitionTabs";
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

  const groups = await computeStandings(competitionId);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        {competition.name}
      </h1>
      <p className="mt-1 text-sm text-score-dim">Standings</p>

      <div className="mt-6">
        <CompetitionTabs
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          active="standings"
        />
      </div>

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
                          <td
                            key={label}
                            className={`${ui.td} text-right tabular-nums`}
                          >
                            {r[field]}
                          </td>
                        ))}
                        <td className={`${ui.td} text-right tabular-nums`}>
                          {fmtRatio(r.srNum)}
                        </td>
                        <td className={`${ui.td} text-right tabular-nums`}>
                          {fmtRatio(r.prNum)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="text-xs text-score-dim">
            Tiebreakers: wins → set ratio → point ratio. Head-to-head resolution
            arrives with the full bracket engine (Phase 8).
          </p>
        </div>
      )}
    </main>
  );
}
