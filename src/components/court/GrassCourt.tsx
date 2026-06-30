import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/grass/types";
import { resolveTeamColor } from "@/lib/colors";
import {
  PositionalCourt,
  surnameOf,
  type CourtSlot,
  type CourtTeam,
} from "@/components/court/PositionalCourt";

// Grass court (3v3 / 4v4) — players placed on a real court in rotation order:
// position 1 is the server (courtPositions[lastRot]) and the rest follow the
// rotation. No attack line (beach-style rules), no libero.
const LAYOUT: Record<number, { front: number[]; back: number[] }> = {
  3: { front: [2, 3], back: [1] },
  4: { front: [2, 3], back: [1, 4] },
};

export function GrassCourt({
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
      color: resolveTeamColor(team === "A" ? teamAColor : teamBColor, team),
      serving,
      front: layout.front.map(slot),
      back: layout.back.map(slot),
    };
  };

  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  return (
    <PositionalCourt
      surfaceLightVar="--court-grass-light"
      surfaceDarkVar="--court-grass-dark"
      left={buildTeam(leftTeam)}
      right={buildTeam(leftTeam === "A" ? "B" : "A")}
      ariaLabel="Grass court"
    />
  );
}
