import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/light/types";
import { CourtView, type CourtCell, type CourtHalfData } from "./CourtView";

// Light court (4- or 5-player). The engine tracks rotation ORDER (lastRot =
// server index); we derive court POSITIONS for display (brief §F3): position 1
// is the server, and the rest follow the rotation order around from there.
// Front row is nearest the net (4-player 3·2; 5-player 4·3·2); the server sits
// at position 1 (back-right). Rendered on the shared flat court (§5).
const LAYOUT: Record<number, { front: number[]; back: number[] }> = {
  4: { front: [3, 2], back: [4, 1] },
  5: { front: [4, 3, 2], back: [5, 1] },
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
    const lastRot = team === "A" ? lastRotA : lastRotB;
    const n = positions.length;
    const name = team === "A" ? teamAName : teamBName;
    const pos1Index = lastRot ?? 0; // rotation index currently at position 1

    const cellAt = (p: number): CourtCell => {
      const idx = (((pos1Index + (p - 1)) % n) + n) % n;
      const pid = positions[idx];
      const player = pid ? rosterById.get(pid) : undefined;
      return {
        key: `${team}-p${p}`,
        jersey: player?.jerseyNumber ?? null,
        name: player?.fullName ?? pid ?? `Position ${p}`,
        posLabel: String(p),
        isServer: serving && p === 1,
        empty: !pid,
      };
    };

    const layout = LAYOUT[n];
    if (!layout) {
      // Unexpected player count — fall back to a single rotation-order row.
      const front = positions.map((pid, idx) => {
        const player = rosterById.get(pid);
        return {
          key: `${team}-${idx}`,
          jersey: player?.jerseyNumber ?? null,
          name: player?.fullName ?? pid,
          posLabel: String(idx + 1),
          isServer: serving && idx === (lastRot ?? -1),
          empty: !pid,
        };
      });
      return { name, serving, front, back: [] };
    }
    return {
      name,
      serving,
      front: layout.front.map(cellAt),
      back: layout.back.map(cellAt),
    };
  };

  return (
    <CourtView
      teamASide={teamASide}
      halfA={buildHalf("A")}
      halfB={buildHalf("B")}
      surface="light"
    />
  );
}
