import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchView,
} from "@/lib/match-engine";
import { MatchProvider } from "@/lib/match-context";
import { LiveScoreboard } from "@/components/scoring/LiveScoreboard";

export const dynamic = "force-dynamic";

export default async function LiveScoringPage({
  params,
}: {
  params: Promise<{
    tenantSlug: string;
    competitionId: string;
    matchId: string;
  }>;
}) {
  const { tenantSlug, competitionId, matchId } = await params;

  // Scoring requires an authenticated user.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const dest = `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}/live`;
    redirect(`/login?redirectTo=${encodeURIComponent(dest)}`);
  }

  let view;
  try {
    view = await loadMatchView(matchId);
  } catch (err) {
    if (err instanceof MatchNotFoundError) notFound();
    if (err instanceof UnsupportedDisciplineError) {
      return (
        <p className="p-6 text-score-dim">
          This discipline isn’t scoreable yet (beach only for now).
        </p>
      );
    }
    throw err;
  }

  return (
    <MatchProvider
      matchId={view.matchId}
      initialState={view.state}
      config={view.config}
    >
      <LiveScoreboard
        competitionName={view.competitionName}
        teamAName={view.teamAName}
        teamBName={view.teamBName}
      />
    </MatchProvider>
  );
}
