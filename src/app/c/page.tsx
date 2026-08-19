/**
 * The public board host's front page (spec/38): every VIS-linked competition,
 * each leading to its day-by-day match list.
 *
 * No sign-in, no tenant, no scoring-platform chrome — this is the page whose
 * link goes to competition staff.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { visCompetitions } from "@/lib/vis-live/resolve";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Scoreboards",
  description: "Venue scoreboard links, by competition and match.",
  robots: { index: false, follow: false },
};

export default async function BoardHostIndex() {
  const comps = await visCompetitions();
  return (
    <main className="min-h-screen bg-surface px-6 py-10 text-foreground">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-score-dim">
          Venue scoreboards
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Competitions</h1>
        <p className="mt-2 max-w-prose text-sm text-score-dim">
          Pick a competition for its match list. Every match has a scoreboard
          link you can copy and send to a venue.
        </p>

        {comps.length === 0 ? (
          <p className="mt-10 text-score-dim">No competitions are linked yet.</p>
        ) : (
          <ul className="mt-8 grid gap-3">
            {comps.map((c) => (
              <li key={c.competitionId}>
                <Link
                  href={`/c/${c.competitionId}`}
                  className="block rounded-lg border border-border px-5 py-4 transition hover:border-foreground"
                >
                  <span className="block font-medium">{c.competitionName}</span>
                  <span className="mt-0.5 block text-xs text-score-dim">
                    VIS tournament {c.visTournamentNo}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
