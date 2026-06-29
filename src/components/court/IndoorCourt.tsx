import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/indoor/types";
import { CourtView, type CourtCell, type CourtHalfData } from "./CourtView";

// Indoor court: six rotation positions per half — front row 4-3-2 (nearest the
// net), back row 5-6-1 (Rule 7.4). Position 1 (server) is highlighted for the
// serving team and the libero is flagged. Rendered on the shared flat court
// (net across the middle, teams facing) — spec/15 §5.
const FRONT = [4, 3, 2];
const BACK = [5, 6, 1];

export function IndoorCourt({
  courtPositionsA,
  courtPositionsB,
  currentServer,
  teamASide,
  teamAName,
  teamBName,
  rosterById,
  liberoIdA,
  liberoIdB,
}: {
  courtPositionsA: string[];
  courtPositionsB: string[];
  currentServer: TeamId | null;
  teamASide: Side;
  teamAName: string;
  teamBName: string;
  rosterById: Map<string, PlayerLite>;
  liberoIdA: string | null;
  liberoIdB: string | null;
}) {
  const buildHalf = (team: TeamId): CourtHalfData => {
    const positions = team === "A" ? courtPositionsA : courtPositionsB;
    const liberoId = team === "A" ? liberoIdA : liberoIdB;
    const serving = currentServer === team;
    const cell = (posNum: number): CourtCell => {
      const pid = positions[posNum - 1];
      const player = pid ? rosterById.get(pid) : undefined;
      return {
        key: `${team}-${posNum}`,
        jersey: player?.jerseyNumber ?? null,
        name: player?.fullName ?? pid ?? `Position ${posNum}`,
        posLabel: String(posNum),
        isServer: posNum === 1 && serving,
        isLibero: pid != null && pid === liberoId,
        empty: !pid,
      };
    };
    return {
      name: team === "A" ? teamAName : teamBName,
      serving,
      front: FRONT.map(cell),
      back: BACK.map(cell),
    };
  };

  return (
    <CourtView
      teamASide={teamASide}
      halfA={buildHalf("A")}
      halfB={buildHalf("B")}
      surface="indoor"
    />
  );
}
