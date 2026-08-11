import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/light/types";
import { resolveTeamColor } from "@/lib/colors";
import {
  PositionalCourt,
  type CourtSlot,
  type CourtTeam,
} from "@/components/court/PositionalCourt";
import { LIGHT_ZONES } from "@/components/court/zones";

// Light/Air court (4- or 5-player) — players on a real court, position 1 = server
// (courtPositions[lastRot]) with the rest following the rotation. Dashed attack
// line (2 m) and a faint service-restraint line near the baseline.
//
// Zone geometry follows the rulebook diagrams (Light Volleyball Competition
// Rules 2022-2025, 8.4.1 four players / 8.4.2 five players): "positions 1 and 2
// are in the same line; positions 3 and 4 are in the same line" (4-player) and
// "positions 1 and 2 are in the same line; positions 4 and 5 are in the same
// line" (5-player). Each column is listed top → bottom, and for the left team
// the team's right-hand side renders at the BOTTOM (so position 1 — the server —
// sits back-bottom, mirrored across the net for the right team). Right-side
// zones therefore come LAST in both columns:
//
//        4-player            5-player
//        ┌──────┬──────┐     ┌──────┬──────┐
//   top  │  4   │  3   │     │  5   │  4   │
//        │      │      │     │      │  3   │
//   bot  │  1   │  2   │     │  1   │  2   │
//        └ back ┴ front┘     └ back ┴ front┘  (net to the right)
//
// This also makes the rotation a clean ring: every step of 2→1→4→3→2 moves to an
// adjacent zone, so players sweep round the court instead of crossing it.
const LAYOUT = LIGHT_ZONES;

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
        name: player?.jerseyName ?? "",
        posLabel: posNum,
        isServer: posNum === 1 && serving,
        isLibero: false,
        present: pid != null,
        // Player identity keys the marker so it SLIDES to its new zone on
        // rotation instead of the zone's contents swapping in place.
        key: pid ?? undefined,
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
