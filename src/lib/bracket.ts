// Single-elimination bracket helpers (spec/10 §"Knockout brackets"). Pure — no
// I/O. The matches table has no explicit feeder linkage, so the bracket is
// represented by convention: a `roundName` from KNOCKOUT_LABELS plus a 1-based
// `matchNumber` slot within the round. Winners of slots 2k-1 and 2k feed slot k
// of the next (smaller) round.

export const KNOCKOUT_LABELS = [
  "Round of 64",
  "Round of 32",
  "Round of 16",
  "Quarterfinal",
  "Semifinal",
  "Final",
  "3rd Place",
] as const;

const KNOCKOUT_SET = new Set<string>(KNOCKOUT_LABELS);

export function isKnockoutRound(roundName: string | null): boolean {
  return roundName != null && KNOCKOUT_SET.has(roundName);
}

/** Label for a round given how many teams contest it (2 → Final, 4 → Semifinal…). */
export function roundLabel(teamsInRound: number): string {
  switch (teamsInRound) {
    case 2:
      return "Final";
    case 4:
      return "Semifinal";
    case 8:
      return "Quarterfinal";
    default:
      return `Round of ${teamsInRound}`;
  }
}

/** Largest power of two ≤ n (min 2). */
export function bracketSize(n: number): number {
  let size = 1;
  while (size * 2 <= n) size *= 2;
  return Math.max(2, size);
}

/**
 * Standard seeding order for a bracket of `size` (power of two): returns seeds
 * 1..size arranged so adjacent pairs are the first-round matchups (1 v size, …).
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

/** Display ordering index for a knockout round (earlier rounds first). */
export function roundOrderIndex(roundName: string): number {
  const i = KNOCKOUT_LABELS.indexOf(roundName as (typeof KNOCKOUT_LABELS)[number]);
  return i < 0 ? 99 : i;
}
