import type { Side, TeamId } from "@/engine/beach/types";

// Clean, functional 16×8 beach court. Shows which side each team occupies and
// the current serving team (arrow + highlighted server dot).
export function BeachCourt({
  teamASide,
  currentServer,
  teamAName,
  teamBName,
}: {
  teamASide: Side;
  currentServer: TeamId | null;
  teamAName: string;
  teamBName: string;
}) {
  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  const rightTeam: TeamId = leftTeam === "A" ? "B" : "A";
  const nameOf = (t: TeamId) => (t === "A" ? teamAName : teamBName);

  const half = (x: number, team: TeamId) => {
    const serving = currentServer === team;
    return (
      <g>
        <rect
          x={x}
          y={20}
          width={140}
          height={160}
          fill={serving ? "var(--court-sand-dark)" : "var(--court-sand-light)"}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={2}
        />
        {/* two player dots */}
        {[60, 120].map((dy) => (
          <circle
            key={dy}
            cx={x + 70}
            cy={dy}
            r={9}
            fill="rgba(0,0,0,0.55)"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1.5}
          />
        ))}
        <text
          x={x + 70}
          y={200}
          textAnchor="middle"
          fontSize={13}
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
      viewBox="0 0 320 210"
      role="img"
      aria-label="Beach court"
      className="mx-auto w-full max-w-xl"
    >
      {/* ocean/sky hint */}
      <rect x={0} y={0} width={320} height={18} fill="#1b3a5c" opacity={0.6} />
      {half(20, leftTeam)}
      {half(160, rightTeam)}
      {/* net */}
      <line
        x1={160}
        y1={12}
        x2={160}
        y2={188}
        stroke="var(--score-active)"
        strokeWidth={3}
        strokeDasharray="4 3"
      />
      <text x={92} y={14} textAnchor="middle" fontSize={10} fill="var(--score-dim)">
        LEFT
      </text>
      <text x={232} y={14} textAnchor="middle" fontSize={10} fill="var(--score-dim)">
        RIGHT
      </text>
    </svg>
  );
}
