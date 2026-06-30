import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/light/types";
import {
  PositionalCourt,
  surnameOf,
  type CourtSlot,
  type CourtTeam,
} from "@/components/court/PositionalCourt";

// Light court (4- or 5-player) — players on a real court, position 1 = server
// (courtPositions[lastRot]) with the rest following the rotation. Front line is
// 2·3 (4-player) or 2·3·4 (5-player); back line is 1·4 or 1·5. Dashed attack
// line (2 m) and a faint service-restraint line near the baseline.
const LAYOUT: Record<number, { front: number[]; back: number[] }> = {
  4: { front: [2, 3], back: [1, 4] },
  5: { front: [2, 3, 4], back: [1, 5] },
};

export function LightCourt({
  courtPositionsA,
  courtPositionsB,
  currentServer,
  lastRotA,
  lastRotB,
  teamASide,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
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
  teamAColor: string | null;
  teamBColor: string | null;
  rosterById: Map<string, PlayerLite>;
}) {
  const buildTeam = (team: TeamId): CourtTeam => {
    const positions = team === "A" ? courtPositionsA : courtPositionsB;
    const rot = (team === "A" ? lastRotA : lastRotB) ?? 0;
    const serving = currentServer === team;
    const n = positions.length;
    const layout =
      LAYOUT[n] ?? { front: positions.map((_, i) => i + 1), back: [] };

    const slot = (posNum: number): CourtSlot => {
      const idx = n > 0 ? (((rot + posNum - 1) % n) + n) % n : 0;
      const pid = positions[idx];
      const player = pid ? rosterById.get(pid) : undefined;
      return {
        jersey: player?.jerseyNumber ?? null,
        name: player ? surnameOf(player.fullName) : "",
        posLabel: posNum,
        isServer: posNum === 1 && serving,
        isLibero: false,
        present: pid != null,
      };
    };

    return {
      name: team === "A" ? teamAName : teamBName,
      color: team === "A" ? teamAColor : teamBColor,
      serving,
      front: layout.front.map(slot),
      back: layout.back.map(slot),
    };
  };

  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  return (
    <PositionalCourt
      surfaceLightVar="--court-light-light"
      surfaceDarkVar="--court-light-dark"
      left={buildTeam(leftTeam)}
      right={buildTeam(leftTeam === "A" ? "B" : "A")}
      attackLine
      restraintLine
      ariaLabel="Light court"
    />
  );
}
