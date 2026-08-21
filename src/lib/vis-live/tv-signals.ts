/**
 * The two TV signals that no single payload can carry (spec/47).
 *
 * A board payload is a snapshot. "A challenge has just been requested" and, on
 * VolleyStation, "a substitution has just happened" are both CHANGES, so they
 * need the previous snapshot next to the new one. That state lives in the store,
 * and the reasoning lives here — as one pure function over (previous state, new
 * board, now), so the whole state machine can be driven by a list of frames in a
 * test instead of by a live match.
 *
 * Nothing here ever throws. A wrong answer puts a graphic on air; an exception
 * in the board path takes a venue screen down, and these two features are not
 * worth that trade.
 */

import type {
  VisBoardData,
  VisChallenge,
  VisChallengeStatus,
  VisSubstitution,
} from "./board-data";

/**
 * How long the "requested" alert stands before the graphic moves on to the
 * review card. Not measured from anything — the feed gives no timing — so it is
 * a production choice: long enough that a viewer reads the tab, short enough
 * that it is gone before the referees signal.
 */
const REVIEW_AFTER_MS = 4_000;
/** How long a decided challenge stays on screen before the bug comes back. */
const RESULT_HOLD_MS = 6_000;

export interface TvSignalState {
  /** Set the counters below belong to; a new set resets them. */
  setNumber: number | null;
  requestedA: number;
  requestedB: number;
  refusedA: number;
  refusedB: number;
  /** Score at the last frame — a challenge upheld moves it. */
  scoreA: number;
  scoreB: number;
  challenge: VisChallenge | null;
  /**
   * The six on court at the last frame, for sources with no sub events. The
   * libero flag is kept, not just the number: a libero going OFF looks exactly
   * like a substitution unless you know what the player who left was.
   */
  sixA: SixSlot[];
  sixB: SixSlot[];
  /** Substitutions inferred so far this set, oldest first. */
  subs: VisSubstitution[];
}

interface SixSlot {
  jersey: number | null;
  isLibero: boolean;
}

export interface TvSignals {
  state: TvSignalState;
  challenge: VisChallenge | null;
  substitutions: VisSubstitution[];
}

const MAX_SUBSTITUTIONS = 8;

function snapshot(board: VisBoardData): Omit<TvSignalState, "challenge" | "subs"> {
  return {
    setNumber: board.currentSet,
    requestedA: board.teamA.challengesRequested,
    requestedB: board.teamB.challengesRequested,
    refusedA: board.teamA.challengesRefused,
    refusedB: board.teamB.challengesRefused,
    scoreA: board.scoreA,
    scoreB: board.scoreB,
    sixA: board.teamA.players.map((p) => ({
      jersey: p.jersey,
      isLibero: p.isLibero,
    })),
    sixB: board.teamB.players.map((p) => ({
      jersey: p.jersey,
      isLibero: p.isLibero,
    })),
  };
}

/**
 * Advance the signal state by one frame.
 *
 * `synthesiseSubs` is on for sources that publish no substitution events
 * (VolleyStation) and OFF for VIS, whose mapper already reports the real ones —
 * with the score they happened at, which an inference cannot recover.
 */
export function tvSignals(
  prev: TvSignalState | null,
  board: VisBoardData,
  now: number,
  opts: { synthesiseSubs: boolean },
): TvSignals {
  const now_ = snapshot(board);

  // First sight of a match, or a new set: adopt the counters as the baseline and
  // announce nothing. Both are states where the counters can jump for reasons
  // that are not a challenge — a cold instance inheriting a set in progress, or
  // a per-set counter resetting to zero — and a graphic fired from either would
  // be a fabrication.
  if (!prev || prev.setNumber !== board.currentSet) {
    return {
      state: { ...now_, challenge: null, subs: [] },
      challenge: null,
      substitutions: [],
    };
  }

  const challenge = nextChallenge(prev, board, now);
  const substitutions = opts.synthesiseSubs
    ? inferSubstitutions(prev, board)
    : board.recentSubstitutions;

  return {
    state: { ...now_, challenge, subs: substitutions.slice(-MAX_SUBSTITUTIONS) },
    challenge,
    substitutions: substitutions.slice(-MAX_SUBSTITUTIONS),
  };
}

/**
 * The challenge state machine.
 *
 *   requested++            → REQUESTED   (the alert tab)
 *   + REVIEW_AFTER_MS      → REVIEW      (the review card)
 *   refused++              → UNSUCCESSFUL
 *   resolved, not refused  → SUCCESSFUL
 *   + RESULT_HOLD_MS       → cleared
 *
 * "Resolved, not refused" is the only inference: a team that wins its challenge
 * keeps the right to another, so `NbChallengeRefused` does NOT move and there is
 * nothing in the feed that says "upheld". What does move is the score — an
 * upheld challenge corrects the call — so a score change while a challenge is
 * open is read as success. A challenge that is upheld WITHOUT changing the score
 * exists in principle and will read as success only once the next point lands;
 * the alternative is never showing a successful challenge at all.
 */
function nextChallenge(
  prev: TvSignalState,
  board: VisBoardData,
  now: number,
): VisChallenge | null {
  const open = prev.challenge;

  // A decided result stands for a beat, then clears.
  if (open && (open.status === "SUCCESSFUL" || open.status === "UNSUCCESSFUL")) {
    return now - open.since >= RESULT_HOLD_MS ? null : open;
  }

  const refusedNow =
    board.teamA.challengesRefused > prev.refusedA
      ? "A"
      : board.teamB.challengesRefused > prev.refusedB
        ? "B"
        : null;
  if (refusedNow) {
    // The refusal is the answer, whether or not we saw the request — a cold
    // instance can join a match mid-challenge.
    return { status: "UNSUCCESSFUL", side: refusedNow, since: now };
  }

  const requestedNow =
    board.teamA.challengesRequested > prev.requestedA
      ? "A"
      : board.teamB.challengesRequested > prev.requestedB
        ? "B"
        : null;
  if (requestedNow) {
    return { status: "REQUESTED", side: requestedNow, since: now };
  }

  if (!open) return null;

  const scoreMoved = board.scoreA !== prev.scoreA || board.scoreB !== prev.scoreB;
  if (scoreMoved) return { status: "SUCCESSFUL", side: open.side, since: now };

  if (open.status === "REQUESTED" && now - open.since >= REVIEW_AFTER_MS) {
    return { status: "REVIEW", side: open.side, since: open.since };
  }
  return open;
}

/**
 * A substitution inferred from the six on court changing.
 *
 * Only emitted when the change is EXACTLY one player out and one in, and
 * neither of them is a libero. Both conditions are there to avoid announcing
 * something that did not happen:
 *
 *  - A libero entering or leaving changes the six identically to a
 *    substitution, happens several times a set, and is not a substitution.
 *    Either end of the pair can be the libero, which is why the previous
 *    frame's flags are kept and not just its numbers.
 *  - Two changes at once means the poll straddled two events, or the feed
 *    rewrote the rotation. Either way the pairing would be a guess, and a lower
 *    third naming the wrong two players is worse than no lower third.
 *
 * The score is taken from the NEW frame: unlike the VIS event stream, an
 * inference cannot know where between the two polls it happened.
 */
function inferSubstitutions(
  prev: TvSignalState,
  board: VisBoardData,
): VisSubstitution[] {
  const out = [...prev.subs];
  for (const side of ["A", "B"] as const) {
    const team = side === "A" ? board.teamA : board.teamB;
    const before = side === "A" ? prev.sixA : prev.sixB;
    const after: SixSlot[] = team.players.map((p) => ({
      jersey: p.jersey,
      isLibero: p.isLibero,
    }));
    if (before.length !== 6 || after.length !== 6) continue;

    const has = (list: SixSlot[], j: number | null) =>
      j != null && list.some((s) => s.jersey === j);
    const left = before.filter((s) => s.jersey != null && !has(after, s.jersey));
    const arrived = after.filter((s) => s.jersey != null && !has(before, s.jersey));
    if (left.length !== 1 || arrived.length !== 1) continue;
    if (left[0].isLibero || arrived[0].isLibero) continue;

    out.push({
      side,
      outJersey: left[0].jersey,
      inJersey: arrived[0].jersey,
      // This source names the incoming player (they are on court now) but has
      // nothing to say about the one who left — the roster is keyed by shirt
      // number and the outgoing number is all we have. The graphic prints the
      // number alone rather than inventing a name.
      outName: null,
      inName: arrived[0].jersey != null
        ? (team.players.find((p) => p.jersey === arrived[0].jersey)?.name ?? null)
        : null,
      setNumber: board.currentSet ?? 0,
      scoreA: board.scoreA,
      scoreB: board.scoreB,
    });
  }
  return out;
}

/** The status a graphic should treat as "still deciding". */
export function isChallengePending(s: VisChallengeStatus): boolean {
  return s === "REQUESTED" || s === "REVIEW";
}
