import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/light/types";

// Light court (4- or 5-player): two halves facing across the net, Team A on the
// left and Team B on the right initially (follows teamASide). Each half shows a
// frontline (5-player 2·3·4, 4-player 2·3) and a backline (1·5 or 1·4); position
// 1 (server) is highlighted. Players are placed by rotation — position 1 is the
// current server (courtPositions[lastRot]) and the rest follow rotation order.
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
  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  const half = (team: TeamId) => ({
    name: team === "A" ? teamAName : teamBName,
    positions: team === "A" ? courtPositionsA : courtPositionsB,
    serving: currentServer === team,
    pos1Index: (team === "A" ? lastRotA : lastRotB) ?? 0,
  });
  const left = half(leftTeam);
  const right = half(leftTeam === "A" ? "B" : "A");

  const cell = (h: ReturnType<typeof half>, posNum: number) => {
    const n = h.positions.length;
    const idx = n > 0 ? (((h.pos1Index + posNum - 1) % n) + n) % n : 0;
    const pid = h.positions[idx];
    const player = pid ? rosterById.get(pid) : undefined;
    const isServer = posNum === 1 && h.serving;
    const label = player ? (player.jerseyNumber ?? "–") : pid ? "•" : "·";
    return (
      <div
        key={posNum}
        className={`relative grid h-12 w-12 place-items-center rounded border text-sm ${
          isServer
            ? "border-primary bg-primary/20 text-foreground"
            : "border-border bg-surface text-score-dim"
        }`}
        title={player?.fullName ?? pid ?? `Position ${posNum}`}
      >
        <span className="absolute left-1 top-0.5 text-[9px] text-score-dim">
          {posNum}
        </span>
        <span className="font-mono font-semibold tabular-nums">{label}</span>
        {isServer ? (
          <span className="absolute bottom-0.5 text-[8px] text-primary">serve</span>
        ) : null}
      </div>
    );
  };

  const halfView = (h: ReturnType<typeof half>) => {
    const layout =
      LAYOUT[h.positions.length] ?? {
        front: h.positions.map((_, i) => i + 1),
        back: [],
      };
    return (
      <div className={`flex-1 rounded-lg p-2 ${h.serving ? "bg-surface-raised" : ""}`}>
        <div className="mb-1 truncate text-center text-xs font-medium">
          {h.name}
          {h.serving ? <span className="text-primary"> ●</span> : null}
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex justify-center gap-1">
            {layout.front.map((p) => cell(h, p))}
          </div>
          <div className="flex justify-center gap-1">
            {layout.back.map((p) => cell(h, p))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-border p-2">
      {halfView(left)}
      <div className="w-px self-stretch bg-foreground/30" aria-hidden />
      {halfView(right)}
    </div>
  );
}
