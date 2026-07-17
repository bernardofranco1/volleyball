import { notFound } from "next/navigation";
import { requireMatchRole, SCORING_ROLES } from "@/lib/authz";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchView,
} from "@/lib/match-engine";
import { loadMatchRosters } from "@/lib/competitions";
import { PreMatchCountdownOverlay } from "@/components/scoreboard/PreMatchCountdownOverlay";
import { ScorerPinGate } from "@/components/scoring/ScorerPinGate";
import { scorerKeyValid, scorerPinSatisfied } from "@/lib/scorer-pin";

export const dynamic = "force-dynamic";

export default async function LiveScoringPage({
  params,
  searchParams,
}: {
  params: Promise<{
    tenantSlug: string;
    competitionId: string;
    matchId: string;
  }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { tenantSlug, competitionId, matchId } = await params;
  const { key } = await searchParams;

  // Authorize against the match's tenant (SCORER/admin) — not just "logged in".
  const dest = `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}/live`;
  await requireMatchRole(matchId, SCORING_ROLES, dest);

  // Per-match scorer PIN gate (brief §5.2) — on top of admin login. No-op for
  // matches without a PIN set.
  // A signed scorer link (?key=<HMAC of the PIN>) pre-satisfies the PIN gate.
  if (!(await scorerPinSatisfied(matchId)) && !(await scorerKeyValid(matchId, key))) {
    return (
      <ScorerPinGate
        tenantSlug={tenantSlug}
        competitionId={competitionId}
        matchId={matchId}
      />
    );
  }

  let view;
  try {
    view = await loadMatchView(matchId);
  } catch (err) {
    if (err instanceof MatchNotFoundError) notFound();
    if (err instanceof UnsupportedDisciplineError) {
      return (
        <p className="p-6 text-score-dim">
          This discipline isn’t scoreable yet.
        </p>
      );
    }
    throw err;
  }

  const scheduledAtMs = view.scheduledAt ? view.scheduledAt.getTime() : null;
  const overlay = <PreMatchCountdownOverlay scheduledAtMs={scheduledAtMs} />;

  // Each branch dynamically imports ONLY its discipline's provider + console —
  // static imports shipped all four engines/action bars (~2k lines of client
  // JS) to every scorer. `view.state` narrows per branch (discriminated union).
  switch (view.discipline) {
    case "INDOOR": {
      const [{ IndoorMatchProvider }, { IndoorScoreboard }, rosters] =
        await Promise.all([
          import("@/lib/indoor-match-context"),
          import("@/components/scoring/IndoorScoreboard"),
          loadMatchRosters(matchId),
        ]);
      return (
        <IndoorMatchProvider
          matchId={view.matchId}
          initialState={view.state}
          config={view.config}
          rosterA={rosters.rosterA}
          rosterB={rosters.rosterB}
          teamAName={view.teamAName}
          teamBName={view.teamBName}
          teamAColor={view.teamAColor}
          teamBColor={view.teamBColor}
        >
          {overlay}
          <IndoorScoreboard competitionName={view.competitionName} />
        </IndoorMatchProvider>
      );
    }
    case "GRASS": {
      const [{ GrassMatchProvider }, { GrassScoreboard }, rosters] =
        await Promise.all([
          import("@/lib/grass-match-context"),
          import("@/components/scoring/GrassScoreboard"),
          loadMatchRosters(matchId),
        ]);
      return (
        <GrassMatchProvider
          matchId={view.matchId}
          initialState={view.state}
          config={view.config}
          rosterA={rosters.rosterA}
          rosterB={rosters.rosterB}
          teamAName={view.teamAName}
          teamBName={view.teamBName}
          teamAColor={view.teamAColor}
          teamBColor={view.teamBColor}
        >
          {overlay}
          <GrassScoreboard competitionName={view.competitionName} />
        </GrassMatchProvider>
      );
    }
    case "LIGHT": {
      const [{ LightMatchProvider }, { LightScoreboard }, rosters] =
        await Promise.all([
          import("@/lib/light-match-context"),
          import("@/components/scoring/LightScoreboard"),
          loadMatchRosters(matchId),
        ]);
      return (
        <LightMatchProvider
          matchId={view.matchId}
          initialState={view.state}
          config={view.config}
          rosterA={rosters.rosterA}
          rosterB={rosters.rosterB}
          teamAName={view.teamAName}
          teamBName={view.teamBName}
          teamAColor={view.teamAColor}
          teamBColor={view.teamBColor}
        >
          {overlay}
          <LightScoreboard competitionName={view.competitionName} />
        </LightMatchProvider>
      );
    }
    case "BEACH": {
      const [{ MatchProvider }, { LiveScoreboard }, rosters] = await Promise.all([
        import("@/lib/match-context"),
        import("@/components/scoring/LiveScoreboard"),
        loadMatchRosters(matchId),
      ]);
      return (
        <MatchProvider
          matchId={view.matchId}
          initialState={view.state}
          config={view.config}
          rosterA={rosters.rosterA}
          rosterB={rosters.rosterB}
          teamAName={view.teamAName}
          teamBName={view.teamBName}
          teamAColor={view.teamAColor}
          teamBColor={view.teamBColor}
        >
          {overlay}
          <LiveScoreboard
            competitionName={view.competitionName}
            teamAName={view.teamAName}
            teamBName={view.teamBName}
            teamAColor={view.teamAColor}
            teamBColor={view.teamBColor}
          />
        </MatchProvider>
      );
    }
  }
}
