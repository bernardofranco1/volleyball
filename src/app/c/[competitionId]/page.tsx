/**
 * Day index for one competition on the public board host (spec/38): every match
 * grouped by its venue-local date, each with its board link and a copy button
 * per layout.
 *
 * The same data as the in-app index, at a URL with no tenant in it and no
 * scoring-platform chrome around it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatchList } from "@/lib/vis-live/store";
import { visCompetitions } from "@/lib/vis-live/resolve";
import type { VisMatchSummary } from "@/lib/vis-live/board-data";
import { MatchLinkRow } from "@/components/scoreboard/MatchLinkRow";

export const dynamic = "force-dynamic";
// Glanced at, not watched — a plain reload keeps it current with no client
// bundle beyond the copy buttons.
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Match list",
  robots: { index: false, follow: false },
};

const RANK = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const;

export default async function BoardHostCompetition({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId } = await params;
  const comp = (await visCompetitions()).find((c) => c.competitionId === competitionId);
  if (!comp) notFound();

  let matches: VisMatchSummary[] = [];
  let error: string | null = null;
  try {
    matches = (await getMatchList(comp.visTournamentNo)).value;
  } catch (err) {
    error = err instanceof Error ? err.message : "VIS unavailable";
  }

  const byDate = new Map<string, VisMatchSummary[]>();
  for (const m of matches) {
    const key = m.dateLocal ?? "—";
    byDate.set(key, [...(byDate.get(key) ?? []), m]);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <main className="min-h-screen bg-surface px-6 py-10 text-foreground">
      <div className="mx-auto max-w-4xl">
        <Link href="/c" className="text-xs uppercase tracking-widest text-score-dim hover:text-foreground">
          ← Competitions
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{comp.competitionName}</h1>
        <p className="mt-2 text-sm text-score-dim">
          Open a match for its scoreboard, or copy the link to send to a venue.
          Board links look like <code className="text-foreground">/m/{matches[0]?.matchNo ?? 12345}</code>.
        </p>

        {error ? (
          <p className="mt-8 rounded-lg border border-border px-5 py-4 text-sm text-score-dim">
            The match list is unavailable right now ({error}). Board links you
            already have keep working.
          </p>
        ) : null}

        {dates.map((date) => {
          const list = [...byDate.get(date)!].sort(
            (a, b) =>
              RANK[a.status] - RANK[b.status] ||
              (a.timeLocal ?? "").localeCompare(b.timeLocal ?? ""),
          );
          return (
            <section key={date} className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-score-dim">
                {date}
              </h2>
              <ul className="mt-3 grid gap-2">
                {list.map((m) => (
                  <li
                    key={m.matchNo}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                  >
                    <Link href={`/m/${m.matchNo}`} className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {m.teamACode || m.teamAName} v {m.teamBCode || m.teamBName}
                      </span>
                      <span className="mt-0.5 block text-xs text-score-dim">
                        {[m.timeLocal, m.hall, `#${m.matchNo}`, m.setsText || m.resultText]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                    <span className="flex items-center gap-3">
                      {m.status === "LIVE" ? (
                        <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          Live
                        </span>
                      ) : null}
                      <MatchLinkRow matchNo={m.matchNo} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
