import type { Side, TeamId } from "@/engine/beach/types";
import { resolveTeamColor } from "@/lib/colors";

// Clean, functional 16×8 beach court. Shows which side each team occupies and
// the current serving team (arrow + highlighted server dot). The two player
// markers per side carry the team's jersey colour.
export function BeachCourt({
  teamASide,
  currentServer,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
}: {
  teamASide: Side;
  currentServer: TeamId | null;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
}) {
  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  const rightTeam: TeamId = leftTeam === "A" ? "B" : "A";
  const nameOf = (t: TeamId) => (t === "A" ? teamAName : teamBName);
  const colorOf = (t: TeamId) =>
    resolveTeamColor(t === "A" ? teamAColor : teamBColor, t);

  // Each half is a 140×140 square so the court is a true 2:1 rectangle (shorter).
  const half = (x: number, team: TeamId) => {
    const serving = currentServer === team;
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
        {/* two player markers in the team's jersey colour */}
        {[62, 112].map((dy) => (
          <circle
            key={dy}
            cx={x + 70}
            cy={dy}
            r={11}
            fill={colorOf(team)}
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={2}
          />
        ))}
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
