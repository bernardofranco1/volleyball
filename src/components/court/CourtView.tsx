// Shared flat-court renderer (brief / spec/15 §5): the net runs across the
// middle and the two teams face each other, front row adjacent to the net, back
// row away. Player positions come from the engine's courtPositionsA/B; rotation
// is reflected live (the engine recomputes positions on side-out) and the
// serving player is highlighted with a serve ball. `teamASide` flips the court
// on a court change (LEFT ⇒ team A on top, RIGHT ⇒ team A on the bottom).

export interface CourtCell {
  key: string;
  jersey: string | number | null;
  name: string | null;
  posLabel: string;
  isServer: boolean;
  isLibero?: boolean;
  empty?: boolean;
}

export interface CourtHalfData {
  name: string;
  serving: boolean;
  front: CourtCell[]; // nearest the net
  back: CourtCell[]; // farthest from the net (may be empty for beach-derived)
}

const SURFACE: Record<string, string> = {
  indoor: "rgba(37,99,235,0.10)",
  grass: "rgba(34,134,58,0.12)",
  light: "rgba(13,148,136,0.12)",
  beach: "rgba(176,137,72,0.14)",
};

function Cell({ c }: { c: CourtCell }) {
  return (
    <div
      className={`relative grid h-14 w-14 place-items-center rounded-md border text-sm transition-colors ${
        c.isServer
          ? "border-primary bg-primary/25 text-foreground shadow-[0_0_0_2px_var(--color-primary)]"
          : c.isLibero
            ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
            : c.empty
              ? "border-dashed border-border/60 bg-transparent text-score-dim"
              : "border-border bg-surface text-foreground"
      }`}
      title={c.name ?? c.posLabel}
    >
      <span className="absolute left-1 top-0.5 text-[9px] leading-none text-score-dim">
        {c.posLabel}
      </span>
      <span className="font-mono font-semibold tabular-nums">
        {c.empty ? "·" : (c.jersey ?? "–")}
      </span>
      {c.isServer ? (
        <span
          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-primary bg-primary"
          title="Serving"
          aria-label="serving"
        />
      ) : null}
    </div>
  );
}

function Row({ cells }: { cells: CourtCell[] }) {
  if (cells.length === 0) return null;
  return (
    <div className="flex justify-center gap-2">
      {cells.map((c) => (
        <Cell key={c.key} c={c} />
      ))}
    </div>
  );
}

function HalfLabel({ half }: { half: CourtHalfData }) {
  return (
    <div className="truncate text-center text-xs font-medium">
      {half.name}
      {half.serving ? <span className="text-primary"> ● serving</span> : null}
    </div>
  );
}

export function CourtView({
  teamASide,
  halfA,
  halfB,
  surface = "indoor",
}: {
  teamASide: "LEFT" | "RIGHT";
  halfA: CourtHalfData;
  halfB: CourtHalfData;
  surface?: "indoor" | "grass" | "light" | "beach";
}) {
  const top = teamASide === "LEFT" ? halfA : halfB;
  const bottom = teamASide === "LEFT" ? halfB : halfA;
  const tint = SURFACE[surface] ?? SURFACE.indoor;

  return (
    <div
      className="rounded-xl border-2 border-foreground/25 p-3"
      style={{ background: tint }}
    >
      {/* TOP half: name, back row, front row (nearest net) */}
      <div className="flex flex-col gap-3 pb-3">
        <HalfLabel half={top} />
        <Row cells={top.back} />
        <Row cells={top.front} />
      </div>

      {/* NET across the middle */}
      <div
        className="my-1 h-3 w-full rounded-sm"
        style={{
          background:
            "repeating-linear-gradient(90deg, var(--color-foreground) 0 2px, transparent 2px 10px)",
          opacity: 0.5,
        }}
        aria-hidden
      />

      {/* BOTTOM half: front row (nearest net), back row, name */}
      <div className="flex flex-col gap-3 pt-3">
        <Row cells={bottom.front} />
        <Row cells={bottom.back} />
        <HalfLabel half={bottom} />
      </div>
    </div>
  );
}
