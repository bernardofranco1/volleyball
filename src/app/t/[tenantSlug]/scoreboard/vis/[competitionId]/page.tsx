/**
 * Day index for a VIS-linked competition (spec/34): every match of the event,
 * grouped by date, each linking to its board.
 *
 * Public, like the rest of /t/{slug}/scoreboard — venue staff open this on a
 * laptop to send the right court to the right screen.
 *
 * Which date, and which time of day, is the reader's choice (spec/46) — their
 * own zone, the venue's, or GMT. That choice reshapes the grouping, so the list
 * itself lives in a client component; this page only fetches.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { getT } from "@/lib/i18n/server";
import { getMatchList, getVisCompetition } from "@/lib/vis-live/store";
import type { VisMatchSummary } from "@/lib/vis-live/board-data";
import { validZoneOrNull } from "@/lib/vis-live/match-times";
import { VisIndexDayList } from "@/components/scoreboard/VisIndexDayList";

export const dynamic = "force-dynamic";
// The index is glanced at, not watched — a plain reload keeps it current.
export const revalidate = 0;

export default async function VisIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const { t } = await getT();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();
  const comp = await getVisCompetition(tenant.id, competitionId);
  if (!comp) notFound();

  let matches: VisMatchSummary[] = [];
  let error: string | null = null;
  let ageSeconds = 0;
  try {
    const res = await getMatchList(comp.visTournamentNo);
    matches = res.value;
    ageSeconds = res.ageSeconds;
  } catch (err) {
    error = err instanceof Error ? err.message : "VIS unavailable";
  }

  const base = `/t/${tenantSlug}/scoreboard/vis/${competitionId}`;

  // Vercel's zone estimate for this connection — the "Local time" fallback for
  // a device that reports no real zone (spec/46). Validated because a header is
  // input; absent in local dev, which simply leaves the fallback off.
  const networkZone = validZoneOrNull((await headers()).get("x-vercel-ip-timezone"));

  // The city as VIS states it on the fixtures, not as the competition record
  // claims: they disagree (tournament 1671 is filed under Doha and played in
  // Chile), and the clock caption is about where the clock is.
  const cities = [...new Set(matches.map((m) => m.city).filter(Boolean))];

  return (
    <main className="min-h-screen bg-surface px-6 py-8 text-foreground">
      <header className="mx-auto max-w-4xl">
        <p className="text-xs uppercase tracking-widest text-score-dim">
          {t("visBoard.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{comp.name}</h1>
        <p className="mt-1 text-sm text-score-dim">
          {[comp.city, comp.country].filter(Boolean).join(", ")}
          {matches.length > 0
            ? ` · ${t("visBoard.matchCount", { count: matches.length })}`
            : ""}
          {ageSeconds > 0
            ? ` · ${t("visBoard.updatedAgo", { seconds: ageSeconds })}`
            : ""}
        </p>
      </header>

      {error ? (
        <p className="mx-auto mt-8 max-w-4xl rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t("visBoard.visUnavailable", { error })}
        </p>
      ) : null}

      <div className="mx-auto mt-6 max-w-4xl space-y-8">
        <VisIndexDayList
          matches={matches}
          base={base}
          venueName={cities.length === 1 ? cities[0] : null}
          networkZone={networkZone}
        />
      </div>
    </main>
  );
}
