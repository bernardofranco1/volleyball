import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { getMatch } from "@/lib/competitions";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchView,
} from "@/lib/match-engine";
import {
  ScoreboardDisplay,
  type DisplayMode,
} from "@/components/scoreboard/ScoreboardDisplay";

// Public, read-only TV display. No auth (excluded from the proxy redirect).
export const dynamic = "force-dynamic";

const MODES: DisplayMode[] = [
  "SCORE_ONLY",
  "SCORE_WITH_SETS",
  "SCORE_WITH_ROTATION",
];

export default async function ScoreboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; matchId: string }>;
  searchParams: Promise<{ display?: string; mode?: string }>;
}) {
  const { tenantSlug, matchId } = await params;
  const { display, mode: modeParam } = await searchParams;

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  // Confirm the match belongs to this tenant before exposing it publicly.
  const match = await getMatch(tenant.id, matchId);
  if (!match) notFound();

  const mode: DisplayMode = MODES.includes(display as DisplayMode)
    ? (display as DisplayMode)
    : "SCORE_WITH_SETS";
  const poll = modeParam === "poll";
  const basePath = `/t/${tenantSlug}/scoreboard/${matchId}`;

  let view;
  try {
    view = await loadMatchView(matchId);
  } catch (err) {
    if (err instanceof MatchNotFoundError) notFound();
    if (err instanceof UnsupportedDisciplineError) {
      return (
        <main className="grid min-h-screen place-items-center bg-surface px-6 text-center">
          <div>
            <h1 className="text-2xl font-semibold">
              {match.teamAName} vs {match.teamBName}
            </h1>
            <p className="mt-2 text-score-dim">
              Live scoreboard is available for beach matches only (for now).
            </p>
          </div>
        </main>
      );
    }
    throw err;
  }

  return (
    <ScoreboardDisplay
      matchId={view.matchId}
      initialState={view.state}
      teamAName={view.teamAName}
      teamBName={view.teamBName}
      competitionName={view.competitionName}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
      accentColor={tenant.branding.primaryColor ?? null}
      timeoutsPerSet={view.config.timeoutsPerSet}
      mode={mode}
      poll={poll}
      basePath={basePath}
    />
  );
}
