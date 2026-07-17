import type { Side, TeamId } from "@/engine/beach/types";
import { resolveTeamColor } from "@/lib/colors";

// Clean, functional 16×8 beach court. Shows which side each team occupies and
// the current serving team (arrow + highlighted server dot). The two player
// markers per side carry the team's jersey colour. When the pair's service
// order is known (SERVICE_ORDER declared), the markers are named — dot 1 is
// the set's first server — and the expected server is ringed.
export interface BeachCourtPlayer {
  name: string;
  /** This player is expected to serve next (rules: alternating service order). */
  serving: boolean;
}

export function BeachCourt({
  teamASide,
  currentServer,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  pairA,
  pairB,
}: {
  teamASide: Side;
  currentServer: TeamId | null;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  /** Team A's players in service order ([player 1, player 2]); null = unknown. */
  pairA?: BeachCourtPlayer[] | null;
  /** Team B's players in service order ([player 1, player 2]); null = unknown. */
  pairB?: BeachCourtPlayer[] | null;
}) {
  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  const rightTeam: TeamId = leftTeam === "A" ? "B" : "A";
  const nameOf = (t: TeamId) => (t === "A" ? teamAName : teamBName);
  const colorOf = (t: TeamId) =>
    resolveTeamColor(t === "A" ? teamAColor : teamBColor, t);
  const pairOf = (t: TeamId) => (t === "A" ? pairA : pairB) ?? null;

  // Each half is a 140×140 square so the court is a true 2:1 rectangle (shorter).
  const half = (x: number, team: TeamId) => {
    const serving = currentServer === team;
    const pair = pairOf(team);
    return (
      <g>
        <rect
          x={x}
          y={16}
          width={140}
          height={140}
          fill={serving ? "var(--court-sand-dark)" : "var(--court-sand-light)"}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={2}
        />
        {/* two player markers in the team's jersey colour; named + server
            ringed once the pair's service order is known */}
        {[62, 112].map((dy, i) => {
          const player = pair?.[i] ?? null;
          const isServer = serving && (player?.serving ?? false);
          // Centred dots when anonymous; shifted left to make room for names.
          const cx = pair ? x + 40 : x + 70;
          return (
            <g key={dy}>
              {isServer ? (
                <circle
                  cx={cx}
                  cy={dy}
                  r={14.5}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                />
              ) : null}
              <circle
                cx={cx}
                cy={dy}
                r={11}
                fill={colorOf(team)}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={2}
              />
              {player ? (
                <text
                  x={cx + 18}
                  y={dy + 4}
                  fontSize={11}
                  fill="var(--score-active)"
                  fontWeight={isServer ? 700 : 500}
                >
                  {player.name}
                </text>
              ) : null}
            </g>
          );
        })}
        <text
          x={x + 70}
          y={172}
          textAnchor="middle"
          fontSize={12}
          fill="var(--score-active)"
          fontWeight={600}
        >
          {nameOf(team)}
          {serving ? " ⬤" : ""}
        </text>
      </g>
    );
  };

  return (
    <svg
      viewBox="0 0 320 184"
      role="img"
      aria-label="Beach court"
      className="mx-auto block h-auto w-full max-w-xl max-h-[48dvh]"
    >
      {/* ocean/sky hint */}
      <rect x={0} y={0} width={320} height={12} fill="#1b3a5c" opacity={0.6} />
      {half(20, leftTeam)}
      {half(160, rightTeam)}
      {/* net */}
      <line
        x1={160}
        y1={10}
        x2={160}
        y2={160}
        stroke="var(--score-active)"
        strokeWidth={3}
        strokeDasharray="4 3"
      />
      <text x={92} y={9} textAnchor="middle" fontSize={8} fill="var(--score-dim)">
        LEFT
      </text>
      <text x={232} y={9} textAnchor="middle" fontSize={8} fill="var(--score-dim)">
        RIGHT
      </text>
    </svg>
  );
}
