import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { getCompetition, listMatches } from "@/lib/competitions";
import { computeStandings, fmtRatio } from "@/lib/standings";
import { loadBracket } from "@/lib/tournament";
import { BracketView } from "@/components/admin/BracketView";
import { statusBadgeClass, ui } from "@/components/admin/styles";

// Public, read-only results (no auth — excluded from the proxy redirect).
export const dynamic = "force-dynamic";

const COLS = [
  ["MP", "mp"],
  ["W", "w"],
  ["L", "l"],
  ["SW", "sw"],
  ["SL", "sl"],
] as const;

export default async function PublicResultsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();
  const competition = await getCompetition(tenant.id, competitionId);
  if (!competition) notFound();

  // The public results of a FINISHED competition are effectively static —
  // serve spectators from a 5-minute cache instead of recomputing per request.
  // Live/draft competitions stay fully dynamic.
  const loadResults = () =>
    Promise.all([
      computeStandings(competitionId),
      loadBracket(competitionId),
      listMatches(competitionId),
    ]);
  const [groups, bracket, matchList] =
    competition.status === "FINISHED"
      ? await unstable_cache(loadResults, ["public-results", competitionId], {
          revalidate: 300,
          tags: [`results:${competitionId}`],
        })()
      : await loadResults();

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-surface text-foreground">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {competition.name}
            </h1>
            <p className="mt-1 text-sm text-score-dim">
              {competition.discipline} · {tenant.name}
            </p>
          </div>
          <a
            href={`/api/competitions/${competitionId}/results.csv`}
            className={ui.btnSecondary}
          >
            CSV
          </a>
        </div>

        {/* Standings */}
        {groups.some((g) => g.rows.length > 0) ? (
          <section className="space-y-6">
            {groups.map((group) => (
              <div key={group.name}>
                <h2 className="mb-2 font-medium">{group.name}</h2>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-raised">
                      <tr>
                        <th className={ui.th}>#</th>
                        <th className={ui.th}>Team</th>
                        {COLS.map(([l]) => (
                          <th key={l} className={`${ui.th} text-right`}>
                            {l}
                          </th>
                        ))}
                        <th className={`${ui.th} text-right`}>SR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r, i) => (
                        <tr key={r.teamId} className="border-t border-border">
                          <td className={`${ui.td} text-score-dim`}>{i + 1}</td>
                          <td className={`${ui.td} font-medium`}>{r.teamName}</td>
                          {COLS.map(([l, f]) => (
                            <td key={l} className={`${ui.td} text-right tabular-nums`}>
                              {r[f]}
                            </td>
                          ))}
                          <td className={`${ui.td} text-right tabular-nums`}>
                            {fmtRatio(r.srNum)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* Bracket */}
        {bracket.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 font-medium">Knockout bracket</h2>
            <div className={ui.card}>
              <BracketView rounds={bracket} />
            </div>
          </section>
        ) : null}

        {/* All results */}
        <section className="mt-8">
          <h2 className="mb-3 font-medium">Matches</h2>
          {matchList.length === 0 ? (
            <p className="text-sm text-score-dim">No matches yet.</p>
          ) : (
            <ul className="space-y-2">
              {matchList.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {m.roundName ? (
                      <span className="text-xs text-score-dim">{m.roundName}</span>
                    ) : null}
                    <span>
                      {m.teamAName} vs {m.teamBName}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {m.status === "FINISHED" ? (
                      <span className="font-mono tabular-nums">
                        {m.setsWonA}–{m.setsWonB}
                      </span>
                    ) : null}
                    <span className={statusBadgeClass(m.status)}>{m.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
