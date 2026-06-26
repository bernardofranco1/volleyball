import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/light/types";

// Light court: 4- or 5-player formats on a 12×6 m court. Each half lists its
// players in rotation order (position 1 = server), current server highlighted.
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
    serverIdx: team === "A" ? lastRotA : lastRotB,
  });

  const halfView = (h: ReturnType<typeof half>) => (
    <div className={`flex-1 rounded-lg p-2 ${h.serving ? "bg-surface-raised" : ""}`}>
      <div className="mb-2 truncate text-center text-xs font-medium">
        {h.name}
        {h.serving ? <span className="text-primary"> ●</span> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {h.positions.map((pid, idx) => {
          const player = rosterById.get(pid);
          const isServer = h.serving && idx === h.serverIdx;
          return (
            <div
              key={idx}
              className={`relative grid h-12 w-12 place-items-center rounded border text-sm ${
                isServer
                  ? "border-primary bg-primary/20 text-foreground"
                  : "border-border bg-surface text-score-dim"
              }`}
              title={player?.fullName ?? pid}
            >
              <span className="absolute left-1 top-0.5 text-[9px] text-score-dim">
                {idx + 1}
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {player ? (player.jerseyNumber ?? "–") : "·"}
              </span>
              {isServer ? (
                <span className="absolute bottom-0.5 text-[8px] text-primary">
                  serve
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-border p-2">
      {halfView(half(leftTeam))}
      <div className="w-px self-stretch bg-foreground/30" aria-hidden />
      {halfView(half(leftTeam === "A" ? "B" : "A"))}
    </div>
  );
}
