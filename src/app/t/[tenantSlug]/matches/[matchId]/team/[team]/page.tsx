import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, players } from "@/db/schema";
import { getTenantBySlug } from "@/lib/tenant";
import { validateTabletToken } from "@/lib/match-session";
import {
  MatchNotFoundError,
  UnsupportedDisciplineError,
  loadMatchView,
} from "@/lib/match-engine";
import { TeamTablet } from "@/components/tablet/TeamTablet";
import type { PlayerLite } from "@/lib/indoor-match-context";
import type { IndoorMatchState } from "@/engine/indoor/types";

// Token-gated, full-screen team tablet (excluded from the proxy auth redirect).
export const dynamic = "force-dynamic";

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="fixed inset-0 z-50 grid place-items-center bg-surface px-6 text-center">
      <div>{children}</div>
    </main>
  );
}

export default async function TeamTabletPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; matchId: string; team: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { tenantSlug, matchId, team } = await params;
  const { token } = await searchParams;

  if (team !== "A" && team !== "B") notFound();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const session = await validateTabletToken(token, matchId, team);
  if (!session) {
    return (
      <Screen>
        <h1 className="text-xl font-semibold">Access link invalid</h1>
        <p className="mt-2 text-sm text-score-dim">
          This team-tablet link is invalid, revoked, or expired. Ask the scorer to
          generate a new QR code.
        </p>
      </Screen>
    );
  }

  let view;
  try {
    view = await loadMatchView(matchId);
  } catch (err) {
    if (err instanceof MatchNotFoundError) notFound();
    if (err instanceof UnsupportedDisciplineError) {
      return (
        <Screen>
          <h1 className="text-xl font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-score-dim">
            Team tablets aren’t supported for this discipline yet.
          </p>
        </Screen>
      );
    }
    throw err;
  }

  // This team's roster.
  const m = (
    await db
      .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
  )[0];
  const teamId = team === "A" ? m?.teamAId : m?.teamBId;
  const roster: PlayerLite[] = teamId
    ? (
        await db
          .select({
            id: players.id,
            fullName: players.fullName,
            jerseyNumber: players.jerseyNumber,
            isLibero: players.isLibero,
          })
          .from(players)
          .where(eq(players.teamId, teamId))
      ).map((r) => ({
        id: r.id,
        fullName: r.fullName,
        jerseyNumber: r.jerseyNumber,
        isLibero: r.isLibero,
      }))
    : [];

  return (
    <TeamTablet
      matchId={matchId}
      team={team}
      token={session.id}
      // The tablet renders the shared score/lineup shape; typed over indoor.
      initialState={view.state as IndoorMatchState}
      roster={roster}
      teamName={team === "A" ? view.teamAName : view.teamBName}
      lineupRequired={view.config.lineupRequired}
      liberoEnabled={view.config.liberoEnabled}
      playersPerSide={view.config.playersPerSide}
    />
  );
}
