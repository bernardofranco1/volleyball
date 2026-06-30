import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/indoor/types";
import {
  PositionalCourt,
  surnameOf,
  type CourtSlot,
  type CourtTeam,
} from "@/components/court/PositionalCourt";

// Indoor court — the six rotation zones placed on a real court (Rule 7.4): front
// row 4·3·2 nearest the net, back row 5·6·1 toward the baseline. Position 1
// (back-right) serves; the libero shows as a hollow ring. courtPositions[i] is
// the player in position i+1.
const FRONT = [4, 3, 2];
const BACK = [5, 6, 1];

export function IndoorCourt({
  courtPositionsA,
  courtPositionsB,
  currentServer,
  teamASide,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
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
  teamAColor: string | null;
  teamBColor: string | null;
  rosterById: Map<string, PlayerLite>;
  liberoIdA: string | null;
  liberoIdB: string | null;
}) {
  const slot = (
    positions: string[],
    zone: number,
    liberoId: string | null,
    serving: boolean,
  ): CourtSlot => {
    const pid = positions[zone - 1];
    const player = pid ? rosterById.get(pid) : undefined;
    return {
      jersey: player?.jerseyNumber ?? null,
      name: player ? surnameOf(player.fullName) : "",
      posLabel: zone,
      isServer: zone === 1 && serving,
      isLibero: pid != null && pid === liberoId,
      present: pid != null,
    };
  };

  const buildTeam = (team: TeamId): CourtTeam => {
    const positions = team === "A" ? courtPositionsA : courtPositionsB;
    const liberoId = team === "A" ? liberoIdA : liberoIdB;
    const serving = currentServer === team;
    return {
      name: team === "A" ? teamAName : teamBName,
      color: team === "A" ? teamAColor : teamBColor,
      serving,
      front: FRONT.map((z) => slot(positions, z, liberoId, serving)),
      back: BACK.map((z) => slot(positions, z, liberoId, serving)),
    };
  };

  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  return (
    <PositionalCourt
      surfaceLightVar="--court-hardwood-light"
      surfaceDarkVar="--court-hardwood-dark"
      left={buildTeam(leftTeam)}
      right={buildTeam(leftTeam === "A" ? "B" : "A")}
      attackLine
      ariaLabel="Indoor court"
    />
  );
}
