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
   * Identity of the challenge the BOARD declared at the last frame, or null
   * (spec/48). What it buys: a declared challenge stays in the payload after it
   * has been decided — VIS's event stream keeps it for the rest of the set — so
   * "is this news?" is exactly "is this a different declaration from the one I
   * saw last time?". Without it the same verdict would be re-announced every
   * poll for the rest of the set.
   */
  declaredKey: string | null;
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

/**
 * Identity of a declared challenge, stable across polls and different for the
 * next one.
 *
 * The score is part of it because a declaration carries no id of its own, and
 * because it is what separates two challenges of the same kind by the same team:
 * a rally has to be played between them, and a rally moves the score. Two
 * identical declarations at the same score — a second challenge granted in the
 * same rally, of the same type, by the same team — would read as one, at the
 * cost of a graphic that never appears. That is the safe direction.
 *
 * `since` is deliberately NOT in it: the mapper stamps that with its own clock,
 * so it changes on every poll.
 */
function declaredKeyOf(board: VisBoardData): string | null {
  const c = board.challenge;
  if (!c) return null;
  return [c.side, c.status, c.category ?? "", board.scoreA, board.scoreB].join(":");
}

function snapshot(board: VisBoardData): Omit<TvSignalState, "challenge" | "subs"> {
  return {
    declaredKey: declaredKeyOf(board),
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
    // One exception, and it is the whole point of a DECLARED challenge: a feed
    // that says a challenge is in flight *right now* is present tense, not
    // history, and that is as true for an instance seeing its first frame as for
    // one that watched the request land. A decided declaration is history and
    // stays silent, exactly like the counters.
    const declared =
      board.challenge && isChallengePending(board.challenge.status)
        ? { ...board.challenge, since: now }
        : null;
    return {
      state: { ...now_, challenge: declared, subs: [] },
      challenge: declared,
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
 * A board that DECLARES its challenge (spec/48: VolleyStation's `challenge_team`,
 * VIS's `<ChallengeRequest>`) short-circuits most of this — the team, the reason
 * and, on VIS, the verdict are stated rather than deduced, so all the machine has
 * to decide is whether the declaration is new and when the alert becomes a card.
 * Everything below it is the counter machine, unchanged, and it still runs on
 * every frame where the feed declares nothing:
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

  const declared = board.challenge;

  // A refusal is read first, declaration or not: the counter moving is a verdict
  // and nothing else, while `challenge_team` may still name a challenge that has
  // just been answered. The category is carried across so a card already on air
  // does not lose its label at the moment it gets its verdict.
  const refusedNow =
    board.teamA.challengesRefused > prev.refusedA
      ? "A"
      : board.teamB.challengesRefused > prev.refusedB
        ? "B"
        : null;
  if (refusedNow) {
    // The refusal is the answer, whether or not we saw the request — a cold
    // instance can join a match mid-challenge.
    const category =
      declared?.side === refusedNow
        ? declared.category
        : open?.side === refusedNow
          ? open.category
          : undefined;
    return {
      status: "UNSUCCESSFUL",
      side: refusedNow,
      since: now,
      ...(category ? { category } : {}),
    };
  }

  // ── the feed states the challenge itself ─────────────────────────────────
  if (declared) {
    const ours =
      open && open.side === declared.side && isChallengePending(open.status)
        ? open
        : null;
    const scoreMoved = board.scoreA !== prev.scoreA || board.scoreB !== prev.scoreB;

    // An upheld challenge corrects the call, so the score moving while the
    // declaration still says "in flight" is that correction landing. Read before
    // anything else, because the score is part of a declaration's identity: left
    // to the test below, the same request would look like a brand new one.
    if (ours && scoreMoved && isChallengePending(declared.status)) {
      return { ...ours, status: "SUCCESSFUL", since: now };
    }

    // A declaration we have not seen before goes on air as it stands, whether it
    // is a request or a verdict: a verdict with no request behind it is a cold
    // instance joining after the review began, and the verdict is what matters.
    const key = declaredKeyOf(board);
    if (key !== prev.declaredKey) return { ...declared, since: now };

    // The same declaration as last time. Only our own clock moves it on.
    if (ours) {
      return ours.status === "REQUESTED" && now - ours.since >= REVIEW_AFTER_MS
        ? { ...ours, status: "REVIEW" }
        : ours;
    }
    // Nothing of ours open: this declaration has already had its turn on air
    // (VIS keeps a decided challenge in the event stream for the rest of the
    // set). It is history now, and history stays off screen.
    return open;
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

  // Spread, so a challenge that was declared with a category keeps it through
  // the verdict — the card's label must not blink out as it turns blue.
  const scoreMoved = board.scoreA !== prev.scoreA || board.scoreB !== prev.scoreB;
  if (scoreMoved) return { ...open, status: "SUCCESSFUL", since: now };

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
