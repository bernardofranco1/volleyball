import type { PlayerLite } from "@/lib/indoor-match-context";
import type { Side, TeamId } from "@/engine/indoor/types";

// Indoor court: each half shows the six rotation positions (front row 4-3-2,
// back row 5-6-1, Rule 7.4). Position 1 (server) is highlighted for the serving
// team; the libero is flagged. Spatial layout is schematic, not to scale.
const FRONT = [4, 3, 2];
const BACK = [5, 6, 1];

export function IndoorCourt({
  courtPositionsA,
  courtPositionsB,
  currentServer,
  teamASide,
  teamAName,
  teamBName,
  rosterById,
  liberoIdA,
  liberoIdB,
}: {
  courtPositionsA: string[];
  courtPositionsB: string[];
  currentServer: TeamId | null;
  teamASide: Side;
  teamAName: string;
  teamBName: string;
  rosterById: Map<string, PlayerLite>;
  liberoIdA: string | null;
  liberoIdB: string | null;
}) {
  const leftTeam: TeamId = teamASide === "LEFT" ? "A" : "B";
  const half = (team: TeamId) => ({
    name: team === "A" ? teamAName : teamBName,
    positions: team === "A" ? courtPositionsA : courtPositionsB,
    liberoId: team === "A" ? liberoIdA : liberoIdB,
    serving: currentServer === team,
  });
  const left = half(leftTeam);
  const right = half(leftTeam === "A" ? "B" : "A");

  const cell = (
    positions: string[],
    posNum: number,
    liberoId: string | null,
    serving: boolean,
  ) => {
    const pid = positions[posNum - 1];
    const player = pid ? rosterById.get(pid) : undefined;
    const isLibero = pid != null && pid === liberoId;
    const isServer = posNum === 1 && serving;
    const label = player
      ? (player.jerseyNumber ?? "–")
      : pid
        ? "•"
        : "·";
    return (
      <div
        key={posNum}
        className={`relative grid aspect-square place-items-center rounded border text-sm ${
          isServer
            ? "border-primary bg-primary/20 text-foreground"
            : isLibero
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
              : "border-border bg-surface text-score-dim"
        }`}
        title={player?.fullName ?? pid ?? `Position ${posNum}`}
      >
        <span className="absolute left-1 top-0.5 text-[9px] text-score-dim">
          {posNum}
        </span>
        <span className="font-mono font-semibold tabular-nums">{label}</span>
        {isServer ? (
          <span className="absolute bottom-0.5 text-[8px] text-primary">
            serve
          </span>
        ) : null}
      </div>
    );
  };

  const halfGrid = (h: ReturnType<typeof half>) => (
    <div className={`flex-1 rounded-lg p-2 ${h.serving ? "bg-surface-raised" : ""}`}>
      <div className="mb-1 truncate text-center text-xs font-medium">
        {h.name}
        {h.serving ? <span className="text-primary"> ●</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {FRONT.map((p) => cell(h.positions, p, h.liberoId, h.serving))}
        {BACK.map((p) => cell(h.positions, p, h.liberoId, h.serving))}
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-border p-2">
      {halfGrid(left)}
      <div className="w-px self-stretch bg-foreground/30" aria-hidden />
      {halfGrid(right)}
    </div>
  );
}
