/**
 * Day index for one competition on the public board host (spec/38): every match
 * grouped by its date, each with its board link and a copy button per layout.
 *
 * The same data as the in-app index, at a URL with no tenant in it and no
 * scoring-platform chrome around it.
 *
 * Which date, and which time of day, is the reader's choice (spec/46) — their
 * own zone, the venue's, or GMT. That choice reshapes the grouping, so the list
 * itself lives in a client component; this page only fetches.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatchList } from "@/lib/vis-live/store";
import { visCompetitions } from "@/lib/vis-live/resolve";
import type { VisMatchSummary } from "@/lib/vis-live/board-data";
import { validZoneOrNull } from "@/lib/vis-live/match-times";
import { MatchDayList } from "@/components/scoreboard/MatchDayList";

export const dynamic = "force-dynamic";
// Glanced at, not watched — a plain reload keeps it current.
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Match list",
  robots: { index: false, follow: false },
};

export default async function BoardHostCompetition({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId } = await params;
  const comp = (await visCompetitions()).find((c) => c.competitionId === competitionId);
  if (!comp) notFound();

  // Vercel's zone estimate for this connection — the "Local time" fallback for
  // a device that reports no real zone (spec/46). Validated because a header is
  // input, and an unformattable zone name would throw at render time. Absent in
  // local dev, which simply leaves the fallback off.
  const networkZone = validZoneOrNull((await headers()).get("x-vercel-ip-timezone"));

  let matches: VisMatchSummary[] = [];
  let error: string | null = null;
  try {
    matches = (await getMatchList(comp.visTournamentNo)).value;
  } catch (err) {
    error = err instanceof Error ? err.message : "VIS unavailable";
  }

  // The city as VIS states it on the fixtures, not as the competition record
  // claims: they disagree (tournament 1671 is filed under Doha and played in
  // Chile), and the caption is about where the clock is.
  const cities = [...new Set(matches.map((m) => m.city).filter(Boolean))];

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

        <MatchDayList
          matches={matches}
          venueName={cities.length === 1 ? cities[0] : null}
          networkZone={networkZone}
        />
      </div>
    </main>
  );
}
