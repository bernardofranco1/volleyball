import type { Side, TeamId } from "@/engine/beach/types";
import type { PlayerNumber } from "@/engine/beach/types";
import { readableTextOn, resolveTeamColor } from "@/lib/colors";

// Clean, functional 16×8 beach court. Shows which side each team occupies and
// the current serving team (darker sand + dot beside the name). Each team's
// two markers carry the service-order number (player 1 = the set's first
// server) in the centre, indoor-style; the player whose turn it is to serve
// gets the same ring + corner-dot markup as PositionalCourt. Surnames appear
// beside the markers once the pair's service order has been declared
// (SERVICE_ORDER) — the slot numbers and serve markup work regardless.
export function BeachCourt({
  teamASide,
  currentServer,
  servingSlot,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  pairA,
  pairB,
}: {
  teamASide: Side;
  currentServer: TeamId | null;
  /** Serve-order slot (1 | 2) of the serving team's expected server. */
  servingSlot: PlayerNumber | null;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  /** Team A surnames in service order ([player 1, player 2]); null = undeclared. */
  pairA?: [string, string] | null;
  /** Team B surnames in service order ([player 1, player 2]); null = undeclared. */
  pairB?: [string, string] | null;
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
    const color = colorOf(team);
    const numColor = readableTextOn(color);
    // Centred markers when anonymous; shifted left to make room for names.
    const cx = pair ? x + 40 : x + 70;
    const R = 11;
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
        {/* the pair, in service order: marker 1 = the set's first server */}
        {([1, 2] as const).map((slot, i) => {
          const dy = [62, 112][i];
          const name = pair?.[i] ?? null;
          const isServer = serving && servingSlot === slot;
          return (
            <g key={slot}>
              {isServer ? (
                <circle
                  cx={cx}
                  cy={dy}
                  r={R + 2.5}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                />
              ) : null}
              <circle
                cx={cx}
                cy={dy}
                r={R}
                fill={color}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1.5}
              />
              <text
                x={cx}
                y={dy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11.5}
                fontWeight={700}
                fill={numColor}
                style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
              >
                {slot}
              </text>
              {isServer ? (
                <circle
                  cx={cx + R - 2}
                  cy={dy - R + 2}
                  r={4}
                  fill="var(--primary)"
                  stroke="#fff"
                  strokeWidth={1}
                />
              ) : null}
              {name ? (
                <text
                  x={cx + 18}
                  y={dy + 4}
                  fontSize={11}
                  fill="var(--score-active)"
                  fontWeight={isServer ? 700 : 500}
                >
                  {name}
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
