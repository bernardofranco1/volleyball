import { notFound, redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, players } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchView,
} from "@/lib/match-engine";
import { MatchProvider } from "@/lib/match-context";
import {
  IndoorMatchProvider,
  type PlayerLite,
} from "@/lib/indoor-match-context";
import { GrassMatchProvider } from "@/lib/grass-match-context";
import { LightMatchProvider } from "@/lib/light-match-context";
import { LiveScoreboard } from "@/components/scoring/LiveScoreboard";
import { IndoorScoreboard } from "@/components/scoring/IndoorScoreboard";
import { GrassScoreboard } from "@/components/scoring/GrassScoreboard";
import { LightScoreboard } from "@/components/scoring/LightScoreboard";
import type { IndoorMatchState } from "@/engine/indoor/types";
import type { GrassMatchState } from "@/engine/grass/types";
import type { LightMatchState } from "@/engine/light/types";

export const dynamic = "force-dynamic";

/** Both teams' rosters as PlayerLite, for indoor lineup/sub entry. */
async function loadRosters(
  matchId: string,
): Promise<{ rosterA: PlayerLite[]; rosterB: PlayerLite[] }> {
  const m = (
    await db
      .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  if (!m) return { rosterA: [], rosterB: [] };
  const rows = await db
    .select({
      id: players.id,
      teamId: players.teamId,
      fullName: players.fullName,
      jerseyNumber: players.jerseyNumber,
      isLibero: players.isLibero,
    })
    .from(players)
    .where(inArray(players.teamId, [m.teamAId, m.teamBId]));
  const lite = (teamId: string): PlayerLite[] =>
    rows
      .filter((r) => r.teamId === teamId)
      .map((r) => ({
        id: r.id,
        fullName: r.fullName,
        jerseyNumber: r.jerseyNumber,
        isLibero: r.isLibero,
      }));
  return { rosterA: lite(m.teamAId), rosterB: lite(m.teamBId) };
}

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
          This discipline isn’t scoreable yet (beach & indoor for now).
        </p>
      );
    }
    throw err;
  }

  if (view.discipline === "INDOOR") {
    const { rosterA, rosterB } = await loadRosters(matchId);
    return (
      <IndoorMatchProvider
        matchId={view.matchId}
        initialState={view.state as unknown as IndoorMatchState}
        config={view.config}
        rosterA={rosterA}
        rosterB={rosterB}
        teamAName={view.teamAName}
        teamBName={view.teamBName}
      >
        <IndoorScoreboard competitionName={view.competitionName} />
      </IndoorMatchProvider>
    );
  }

  if (view.discipline === "GRASS") {
    const { rosterA, rosterB } = await loadRosters(matchId);
    return (
      <GrassMatchProvider
        matchId={view.matchId}
        initialState={view.state as unknown as GrassMatchState}
        config={view.config}
        rosterA={rosterA}
        rosterB={rosterB}
        teamAName={view.teamAName}
        teamBName={view.teamBName}
      >
        <GrassScoreboard competitionName={view.competitionName} />
      </GrassMatchProvider>
    );
  }

  if (view.discipline === "LIGHT") {
    const { rosterA, rosterB } = await loadRosters(matchId);
    return (
      <LightMatchProvider
        matchId={view.matchId}
        initialState={view.state as unknown as LightMatchState}
        config={view.config}
        rosterA={rosterA}
        rosterB={rosterB}
        teamAName={view.teamAName}
        teamBName={view.teamBName}
      >
        <LightScoreboard competitionName={view.competitionName} />
      </LightMatchProvider>
    );
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
