/**
 * An independent model of where the six are standing (spec/42).
 *
 * The board takes its rotation from the `LineUp` VIS attaches to each rally.
 * Measured over four matches that is right essentially always — three of them
 * agreed with the score on every clean transition — but not quite always: one
 * match missed nine rotations and invented one. And the feed REWRITES a rally's
 * lineup for some seconds after the rally, which at a one-second poll the board
 * renders as a flicker.
 *
 * So this module derives the rotation from first principles instead, purely
 * from the running score, and the caller compares the two. Nothing here is
 * displayed: it exists to be logged, so a day's divergences can be read back
 * and the feed judged on evidence rather than on impression.
 *
 * The rules it encodes:
 *   - the winner of rally N serves rally N+1;
 *   - a team that wins a rally it did NOT serve has won a side-out, and rotates
 *     one place before serving (position 2 becomes position 1);
 *   - the serving team's rotation is the one that matters, because position 1
 *     is the server;
 *   - a libero is not part of rotation. They come and go from the six without
 *     anybody moving, so they are canonicalised away before two lineups are
 *     compared, or every libero swap would read as a divergence.
 */

import { allTagAttrs, num, type Attrs } from "./parse";

export type Side = "A" | "B";

export interface RallyFacts {
  /** 1-based index within the set, not the match-wide Rally@No. */
  index: number;
  scoreA: number;
  scoreB: number;
  /** Who won it, or null when the feed moved neither score. */
  winner: Side | null;
}

/** One place clockwise: position 2 takes position 1, position 1 goes to 6. */
export function rotateOnce<T>(six: readonly T[]): T[] {
  return six.length === 6 ? [...six.slice(1), six[0]] : [...six];
}

/** The running score each rally stamps, turned into who won it. */
export function ralliesOf(setInner: string): RallyFacts[] {
  const rows = allTagAttrs(setInner, "Rally");
  const out: RallyFacts[] = [];
  let prevA = 0;
  let prevB = 0;
  rows.forEach((r, i) => {
    const scoreA = num(r, "PointsTeamA");
    const scoreB = num(r, "PointsTeamB");
    out.push({
      index: i + 1,
      scoreA,
      scoreB,
      winner: scoreA > prevA ? "A" : scoreB > prevB ? "B" : null,
    });
    prevA = scoreA;
    prevB = scoreB;
  });
  return out;
}

/**
 * How many times each side has rotated by the time rally `upTo` is about to be
 * played, given who served the set's first rally.
 *
 * `upTo` is exclusive: pass `rallies.length + 1` for the rally now in progress,
 * which is the one the board is showing and the one VIS has not published.
 */
export function rotationsBefore(
  rallies: RallyFacts[],
  firstServer: Side,
  upTo: number,
): { A: number; B: number } {
  const count = { A: 0, B: 0 };
  let server: Side = firstServer;
  for (const r of rallies) {
    if (r.index >= upTo) break;
    if (!r.winner) continue;
    if (r.winner !== server) {
      // A side-out: the winner takes the serve, and rotates to do it.
      count[r.winner] += 1;
      server = r.winner;
    }
  }
  return count;
}

/** Lineups keyed by team number, canonicalised so liberos do not read as moves. */
export type Six = string[];

export function canonicalise(six: Six, liberos: ReadonlySet<string>): Six {
  return six.map((p) => (liberos.has(p) ? "L" : p));
}

export function sixOf(lineup: Attrs): Six {
  return [1, 2, 3, 4, 5, 6].map((i) => String(lineup[`NoPlayer${i}`] ?? ""));
}

/**
 * Which side served the set's first rally.
 *
 * Preferred source is an observation: while a set has no rallies at all,
 * `Set@NoServingTeam` IS the first server, and a board polling every second
 * always sees that state — so the caller passes `remembered` when it has one.
 *
 * Without it the answer is still recoverable, because the feed's own published
 * lineups encode it: run the model under both hypotheses and keep whichever
 * predicts more of them. A set has to be a few rallies old before that
 * separates, which is exactly when the remembered value is unavailable anyway.
 */
export function inferFirstServer(
  rallies: RallyFacts[],
  starting: Record<Side, Six>,
  published: Record<Side, (Six | null)[]>,
  liberos: ReadonlySet<string>,
  remembered: Side | null,
): { firstServer: Side | null; confidence: "observed" | "inferred" | "unknown" } {
  if (remembered) return { firstServer: remembered, confidence: "observed" };
  if (rallies.length < 3) return { firstServer: null, confidence: "unknown" };

  const score = (hypothesis: Side): number => {
    let hits = 0;
    for (const side of ["A", "B"] as const) {
      const base = canonicalise(starting[side], liberos);
      for (const r of rallies) {
        const seen = published[side][r.index - 1];
        if (!seen) continue;
        const turns = rotationsBefore(rallies, hypothesis, r.index)[side];
        let expect = base;
        for (let i = 0; i < turns % 6; i++) expect = rotateOnce(expect);
        if (expect.join() === canonicalise(seen, liberos).join()) hits++;
      }
    }
    return hits;
  };

  const a = score("A");
  const b = score("B");
  if (a === b) return { firstServer: null, confidence: "unknown" };
  return { firstServer: a > b ? "A" : "B", confidence: "inferred" };
}
