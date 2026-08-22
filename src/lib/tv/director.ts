/**
 * What is on screen, and for how long (spec/47).
 *
 * A pure reducer: `(memory, delayed board, operator, now) → next memory +
 * graphics`. Pure because the interesting behaviour here is all timing and
 * precedence, and timing bugs are only findable by driving a recorded sequence
 * of frames through it in a test — never by watching a match and hoping.
 *
 * It runs on the DELAYED board (see useDelayedBoard), so "a substitution just
 * happened" means "just happened in the picture the viewer is looking at". That
 * is the whole point of the delay: everything the director decides is in sync
 * with the footage, not with the hall.
 */

import type {
  VisBoardData,
  VisChallengeStatus,
  VisSubstitution,
} from "@/lib/vis-live/board-data";
import { handOf, keyMoment, type Hand, type KeyMoment, type Side } from "./derive";

/** A substitution stays up long enough to be read aloud, and no longer. */
const SUB_HOLD_MS = 8_000;
/**
 * A team time-out is 30 seconds. The tab stays for it, and comes down early the
 * moment play resumes — a graphic still on screen when the ball is up is worse
 * than one that left a beat early.
 */
const TIMEOUT_HOLD_MS = 30_000;

/** The categories a challenge can be, in hotkey order (1–6). Operator input. */
export const CHALLENGE_CATEGORIES = [
  "BALL IN / OUT",
  "NET TOUCH",
  "FOOT FAULT",
  "TOUCH ON BLOCK",
  "ANTENNA TOUCH",
  "FLOOR TOUCH",
] as const;
/**
 * A label the FEED can name that no hotkey does (spec/48 §3). Kept out of
 * `CHALLENGE_CATEGORIES` so the hotkey row stays 1–6 as the operators learned
 * it; a card can still print this when the feed asks for it.
 */
export const FEED_ONLY_CATEGORIES = ["NET REACH"] as const;
export type ChallengeCategory =
  | (typeof CHALLENGE_CATEGORIES)[number]
  | (typeof FEED_ONLY_CATEGORIES)[number];

/**
 * Feed reason → card label (spec/48 §3).
 *
 * Keyed lower-case, because the two feeds spell the same event differently:
 * VolleyStation sends `"netTouch"` and VIS's `ChallengeRequest@Type` resolves to
 * `"NetTouch"`. Both land here.
 *
 * A reason that is NOT in this map auto-fills nothing — the card shows "UNDER
 * REVIEW" until the operator presses a key. That is deliberate for the three VIS
 * line faults (`AttackLineFault`, `CenterLineFault`, `ServiceLineFault`): they
 * are all arguably "FOOT FAULT", none of them is certainly it, and inventing the
 * mapping would put a wrong word on air where a blank one is honest.
 */
const CATEGORY_BY_REASON: Record<string, ChallengeCategory> = {
  ballinout: "BALL IN / OUT",
  nettouch: "NET TOUCH",
  blocktouch: "TOUCH ON BLOCK",
  antennatouch: "ANTENNA TOUCH",
  // The same event under each feed's own name: VolleyStation calls the ball
  // touching the floor a defence touch, VIS type 8 calls it a floor touch.
  defensetouch: "FLOOR TOUCH",
  floortouch: "FLOOR TOUCH",
  netreach: "NET REACH",
};

/** The card label for a raw feed reason, or null when we do not know it. */
export function categoryFor(reason: string | null | undefined): ChallengeCategory | null {
  const key = (reason ?? "").trim().toLowerCase();
  return key ? (CATEGORY_BY_REASON[key] ?? null) : null;
}

export interface OperatorState {
  /** Everything off. The director still runs, so nothing is missed on the way back. */
  hideAll: boolean;
  /**
   * The category to print on the challenge card. Both feeds do carry a reason
   * (spec/48 §3), so this is now an OVERRIDE rather than the only source: set,
   * it wins; null, the feed's own reason auto-fills through `categoryFor`.
   */
  category: ChallengeCategory | null;
  /**
   * A challenge driven entirely by the operator, for when the feed's counters
   * lag or never move (which is the expected case on a VolleyStation-sourced
   * match — see spec/47 §3).
   */
  manualChallenge: { side: Side; status: VisChallengeStatus } | null;
  /** A time-out the operator called for by hand. */
  manualTimeout: { side: Side; at: number } | null;
}

export const NO_OPERATOR: OperatorState = {
  hideAll: false,
  category: null,
  manualChallenge: null,
  manualTimeout: null,
};

export interface DirectorMemory {
  /** Substitution keys already put on air — including the backlog at load. */
  announced: string[];
  /** The substitution on air now. */
  sub: { key: string; hand: Hand; sub: VisSubstitution; until: number } | null;
  /** The time-out tab on air now. */
  timeout: { hand: Hand; until: number } | null;
  timeoutsA: number;
  timeoutsB: number;
  scoreA: number;
  scoreB: number;
  setNumber: number | null;
}

export interface Graphics {
  /** The permanent bug. Down only while a full-width challenge card is up. */
  bug: boolean;
  keyMoment: { hand: Hand; text: KeyMoment } | null;
  timeout: { hand: Hand } | null;
  substitution: { hand: Hand; sub: VisSubstitution } | null;
  challenge: {
    hand: Hand;
    status: VisChallengeStatus;
    category: ChallengeCategory | null;
    /** The requesting team's name, for the "VIDEO CHALLENGE BY …" header. */
    teamName: string;
  } | null;
}

export const NOTHING: Graphics = {
  bug: false,
  keyMoment: null,
  timeout: null,
  substitution: null,
  challenge: null,
};

/** Identity of a substitution, stable across polls. */
export function subKey(s: VisSubstitution): string {
  return [s.side, s.setNumber, s.scoreA, s.scoreB, s.outJersey, s.inJersey].join(":");
}

/**
 * Seed the memory from the first frame WITHOUT announcing anything.
 *
 * A page opened at 18-14 in the third set has a list of substitutions that all
 * already happened. Firing them in sequence would put five lower thirds on air
 * over a live rally, which is the single worst thing this feature could do.
 */
export function seedDirector(board: VisBoardData): DirectorMemory {
  return {
    announced: board.recentSubstitutions.map(subKey),
    sub: null,
    timeout: null,
    timeoutsA: board.teamA.timeoutsTaken,
    timeoutsB: board.teamB.timeoutsTaken,
    scoreA: board.scoreA,
    scoreB: board.scoreB,
    setNumber: board.currentSet,
  };
}

export function direct(
  memory: DirectorMemory,
  board: VisBoardData,
  operator: OperatorState,
  now: number,
): { memory: DirectorMemory; graphics: Graphics } {
  const hand = handOf(board);
  const handFor = (side: Side): Hand => (hand.left === side ? "left" : "right");

  // A new set resets the per-set counters, so adopt them rather than read the
  // reset as two time-outs being returned.
  const newSet = memory.setNumber !== board.currentSet;
  const next: DirectorMemory = newSet
    ? { ...seedDirector(board), announced: memory.announced }
    : { ...memory };

  // ── time-out ───────────────────────────────────────────────────────────────
  const scoreMoved = board.scoreA !== memory.scoreA || board.scoreB !== memory.scoreB;
  if (!newSet) {
    const calledBy: Side | null =
      board.teamA.timeoutsTaken > memory.timeoutsA
        ? "A"
        : board.teamB.timeoutsTaken > memory.timeoutsB
          ? "B"
          : null;
    if (calledBy) {
      next.timeout = { hand: handFor(calledBy), until: now + TIMEOUT_HOLD_MS };
    } else if (next.timeout && (now >= next.timeout.until || scoreMoved)) {
      next.timeout = null;
    }
  }
  if (operator.manualTimeout) {
    next.timeout = {
      hand: handFor(operator.manualTimeout.side),
      until: operator.manualTimeout.at + TIMEOUT_HOLD_MS,
    };
    if (now >= next.timeout.until) next.timeout = null;
  }
  next.timeoutsA = board.teamA.timeoutsTaken;
  next.timeoutsB = board.teamB.timeoutsTaken;
  next.scoreA = board.scoreA;
  next.scoreB = board.scoreB;
  next.setNumber = board.currentSet;

  // ── substitution ───────────────────────────────────────────────────────────
  if (next.sub && now >= next.sub.until) next.sub = null;
  if (!next.sub) {
    // Oldest unannounced first, so a pair made together goes out in order.
    const pending = board.recentSubstitutions.find(
      (s) => !next.announced.includes(subKey(s)),
    );
    if (pending) {
      const key = subKey(pending);
      next.sub = {
        key,
        hand: handFor(pending.side),
        sub: pending,
        until: now + SUB_HOLD_MS,
      };
      next.announced = [...next.announced, key].slice(-40);
    }
  }
  // Anything still unannounced when the list rolls past the cap is never coming
  // back; mark the ones that have fallen out so the list cannot grow forever.
  const live = new Set(board.recentSubstitutions.map(subKey));
  next.announced = next.announced.filter(
    (k) => live.has(k) || k === next.sub?.key,
  );

  // ── challenge ──────────────────────────────────────────────────────────────
  const fromFeed = board.challenge;
  const manual = operator.manualChallenge;
  const chosen: { side: Side; status: VisChallengeStatus } | null = manual
    ? manual
    : fromFeed
      ? { side: fromFeed.side, status: fromFeed.status }
      : null;
  const challenge: Graphics["challenge"] = chosen
    ? {
        hand: handFor(chosen.side),
        status: chosen.status,
        // The operator's key overrides the feed, always: they can see the replay
        // and the feed's reason may be a scorer's first guess. With no key
        // pressed the feed's own reason auto-fills, and an unknown one leaves the
        // card saying UNDER REVIEW exactly as it did before spec/48.
        category: operator.category ?? categoryFor(fromFeed?.category),
        teamName:
          (chosen.side === "A" ? board.teamA.name : board.teamB.name) ||
          (chosen.side === "A" ? board.teamA.code : board.teamB.code),
      }
    : null;

  // A full-width card replaces the bug; the small alert tab sits on top of it.
  const cardUp = !!challenge && challenge.status !== "REQUESTED";

  if (operator.hideAll) {
    return { memory: next, graphics: NOTHING };
  }

  return {
    memory: next,
    graphics: {
      bug: !cardUp,
      // Precedence: nothing shares the bar with a challenge, and a substitution
      // outranks a time-out on the same side — it names players, the time-out
      // only names a team, and the substitution's window is much shorter.
      keyMoment: cardUp
        ? null
        : (() => {
            for (const side of ["A", "B"] as const) {
              const km = keyMoment(board, side);
              if (km) return { hand: handFor(side), text: km };
            }
            return null;
          })(),
      substitution: cardUp || !next.sub
        ? null
        : { hand: next.sub.hand, sub: next.sub.sub },
      timeout:
        cardUp || !next.timeout || next.sub?.hand === next.timeout.hand
          ? null
          : { hand: next.timeout.hand },
      challenge,
    },
  };
}

/**
 * A graphic forced on for rehearsal (`/tv/mock?demo=sub`).
 *
 * Not a toy. Substitutions and challenges are rare and unschedulable: without
 * this the first time anyone sees the substitution lower third is during a live
 * match, which is also the first chance to notice that a name overflows its box
 * or an arrow points the wrong way. It is also what the render gate screenshots.
 *
 * Query-gated on a noindex page and it invents nothing the feed would not
 * otherwise supply — the sample player names come from the board's own six.
 */
export type DemoGraphic =
  | "sub"
  /** A second substitution taking the plate the first is still on (spec/48.1 F1). */
  | "subswap"
  | "challenge"
  | "review"
  | "success"
  | "fail"
  | "timeout"
  | "keymoment"
  /** Motion rehearsals (spec/48 G4): the two things the FEED normally drives. */
  | "sideout"
  | "point";

export function demoGraphics(
  demo: DemoGraphic,
  board: VisBoardData,
  category: ChallengeCategory | null,
  /** The rehearsal beat, for the one demo that changes over time (`subswap`). */
  beat = 0,
): Graphics {
  const hand = handOf(board);
  const left = hand.left;
  const six = (left === "A" ? board.teamA : board.teamB).players;
  const name = (i: number) => six[i]?.name ?? null;
  const jersey = (i: number) => six[i]?.jersey ?? null;

  const base: Graphics = { ...NOTHING, bug: true };
  /** One substitution on the left, naming the board's own players. */
  const subOf = (out: number, inn: number, at: number): Graphics["substitution"] => ({
    hand: "left",
    sub: {
      side: left,
      outJersey: jersey(out),
      outName: name(out),
      inJersey: jersey(inn),
      inName: name(inn),
      setNumber: board.currentSet ?? 1,
      // The score the substitution was made at. It is not drawn — it is part of
      // the director's `subKey`, which is what tells one substitution from the
      // next, so the rehearsal below varies it and the swap is exercised even on
      // a board whose roster is short of four names.
      scoreA: board.scoreA + at,
      scoreB: board.scoreB,
    },
  });

  switch (demo) {
    case "sub":
      return { ...base, substitution: subOf(0, 1, 0) };
    case "subswap": {
      // Two pairs made together on ONE side, three beats each — the case the
      // director handles by announcing the second in the tick it drops the
      // first, so the plate never leaves and the content has to hand over on it
      // (spec/48.1 F1). 2.7 s a pair: the fade is 260 ms and the drift 420 ms,
      // so each stands still long enough to be read before the next takes over.
      const second = Math.floor(beat / 3) % 2 === 1;
      return {
        ...base,
        substitution: second ? subOf(2, 3, 1) : subOf(0, 1, 0),
      };
    }
    case "timeout":
      return { ...base, timeout: { hand: "left" } };
    case "keymoment":
      return { ...base, keyMoment: { hand: "left", text: "MATCH POINT" } };
    // The motion rehearsals show the BUG and nothing else: what they exercise is
    // the score and the serving side, which are not graphics at all — see
    // demoBoard, which drives them.
    case "sideout":
    case "point":
      return base;
    default: {
      const status: VisChallengeStatus =
        demo === "challenge"
          ? "REQUESTED"
          : demo === "review"
            ? "REVIEW"
            : demo === "success"
              ? "SUCCESSFUL"
              : "UNSUCCESSFUL";
      return {
        ...base,
        bug: status === "REQUESTED",
        challenge: {
          hand: "left",
          status,
          category: category ?? "BALL IN / OUT",
          teamName:
            (left === "A" ? board.teamA.name : board.teamB.name) ||
            (left === "A" ? board.teamA.code : board.teamB.code),
        },
      };
    }
  }
}

/** Parse `?demo=` into a graphic, or null. */
export function parseDemo(raw: string | undefined | null): DemoGraphic | null {
  const all: DemoGraphic[] = [
    "sub", "subswap", "challenge", "review", "success", "fail", "timeout",
    "keymoment", "sideout", "point",
  ];
  return all.find((d) => d === raw) ?? null;
}

/**
 * The rehearsal beat. One tick every 900 ms, and every motion demo below is a
 * multiple of it, so one interval drives all of them.
 */
export const DEMO_BEAT_MS = 900;

/**
 * A rehearsal board for the two demos that are about MOVEMENT rather than about
 * a graphic (spec/48 G4).
 *
 * The other demos force a panel on; these two force the two things the feed
 * normally drives and nobody can schedule — a side-out and a point — so the
 * flight and the odometer can be watched, and re-watched, without waiting for a
 * live rally. Pure: it takes the beat, not a clock.
 *
 * `point` deliberately walks the score DOWN once per cycle and across 9 → 10:
 * the roll-back is what a challenge overturn or an undo looks like, and the
 * two-digit crossing is where the advance-box re-centring (bug-geometry.ts:148)
 * meets the odometer's clip. Both are exactly the cases a rehearsal is for.
 */
export function demoBoard(
  demo: DemoGraphic,
  board: VisBoardData,
  beat: number,
): VisBoardData {
  if (demo === "sideout") {
    // Every third beat, i.e. 2.7 s — the flight itself is 850 ms, so the ball
    // rests visibly on each side between crossings.
    return { ...board, serving: Math.floor(beat / 3) % 2 === 0 ? "A" : "B" };
  }
  if (demo === "point") {
    // The two cells advance on alternate beats, never together: a real rally
    // scores one side, and two odometers rolling at once hides which is which.
    return {
      ...board,
      scoreA: 8 + (Math.floor(beat / 2) % 5),
      scoreB: 19 + (Math.floor((beat + 1) / 2) % 4),
    };
  }
  return board;
}
