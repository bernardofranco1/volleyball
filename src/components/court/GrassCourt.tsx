import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/grass/types";
import { CourtView, type CourtCell, type CourtHalfData } from "./CourtView";

// Grass court (3- or 4-player): beach-derived rotation, so players are shown in
// rotation order in a single row facing the net. Server = courtPositions[lastRot]
// is highlighted. Rendered on the shared flat court (net across the middle) — §5.
export function GrassCourt({
  courtPositionsA,
  courtPositionsB,
  currentServer,
  lastRotA,
  lastRotB,
  teamASide,
  teamAName,
  teamBName,
  rosterById,
}: {
  courtPositionsA: string[];
  courtPositionsB: string[];
  currentServer: TeamId | null;
  lastRotA: number | null;
  lastRotB: number | null;
  teamASide: Side;
  teamAName: string;
  teamBName: string;
  rosterById: Map<string, PlayerLite>;
}) {
  const buildHalf = (team: TeamId): CourtHalfData => {
    const positions = team === "A" ? courtPositionsA : courtPositionsB;
    const serving = currentServer === team;
    const serverIdx = team === "A" ? lastRotA : lastRotB;
    const front: CourtCell[] = positions.map((pid, idx) => {
      const player = rosterById.get(pid);
      return {
        key: `${team}-${idx}`,
        jersey: player?.jerseyNumber ?? null,
        name: player?.fullName ?? pid,
        posLabel: String(idx + 1),
        isServer: serving && idx === serverIdx,
        empty: !pid,
      };
    });
    return { name: team === "A" ? teamAName : teamBName, serving, front, back: [] };
  };

  return (
    <CourtView
      teamASide={teamASide}
      halfA={buildHalf("A")}
      halfB={buildHalf("B")}
      surface="grass"
    />
  );
}
