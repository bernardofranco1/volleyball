import type { BracketMatch } from "@/lib/tournament";
import { statusBadgeClass } from "@/components/admin/styles";

// Read-only knockout bracket: columns of rounds, each a stack of match cards.
export function BracketView({
  rounds,
  matchHref,
}: {
  rounds: { round: string; matches: BracketMatch[] }[];
  matchHref?: (matchId: string) => string;
}) {
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-score-dim">
        No bracket yet. Seed one once pool play is done.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-4">
        {rounds.map((r) => (
          <div key={r.round} className="flex w-52 flex-col gap-3">
            <div className="text-center text-xs font-medium uppercase tracking-wide text-score-dim">
              {r.round}
            </div>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {r.matches.map((m) => {
                const card = (
                  <div className="rounded-lg border border-border bg-surface-raised p-2">
                    <Row
                      name={m.teamAName}
                      score={m.setsWonA}
                      win={m.winner === "A"}
                    />
                    <div className="my-1 border-t border-border" />
                    <Row
                      name={m.teamBName}
                      score={m.setsWonB}
                      win={m.winner === "B"}
                    />
                    <div className="mt-1 text-right">
                      <span className={statusBadgeClass(m.status)}>{m.status}</span>
                    </div>
                  </div>
                );
                return matchHref ? (
                  <a key={m.id} href={matchHref(m.id)} className="block hover:opacity-90">
                    {card}
                  </a>
                ) : (
                  <div key={m.id}>{card}</div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ name, score, win }: { name: string; score: number; win: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`truncate ${win ? "font-semibold text-foreground" : "text-score-dim"}`}>
        {name}
      </span>
      <span className="ml-2 font-mono tabular-nums">{score}</span>
    </div>
  );
}
