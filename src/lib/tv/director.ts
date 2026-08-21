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

/** The categories a challenge can be, in hotkey order. Operator input. */
export const CHALLENGE_CATEGORIES = [
  "BALL IN / OUT",
  "NET TOUCH",
  "FOOT FAULT",
  "TOUCH ON BLOCK",
  "ANTENNA TOUCH",
  "FLOOR TOUCH",
] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export interface OperatorState {
  /** Everything off. The director still runs, so nothing is missed on the way back. */
  hideAll: boolean;
  /** The category to print on the challenge card; no feed carries this. */
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
        category: operator.category,
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
  | "challenge"
  | "review"
  | "success"
  | "fail"
  | "timeout"
  | "keymoment";

export function demoGraphics(
  demo: DemoGraphic,
  board: VisBoardData,
  category: ChallengeCategory | null,
): Graphics {
  const hand = handOf(board);
  const left = hand.left;
  const six = (left === "A" ? board.teamA : board.teamB).players;
  const name = (i: number) => six[i]?.name ?? null;
  const jersey = (i: number) => six[i]?.jersey ?? null;

  const base: Graphics = { ...NOTHING, bug: true };
  switch (demo) {
    case "sub":
      return {
        ...base,
        substitution: {
          hand: "left",
          sub: {
            side: left,
            outJersey: jersey(0),
            outName: name(0),
            inJersey: jersey(1),
            inName: name(1),
            setNumber: board.currentSet ?? 1,
            scoreA: board.scoreA,
            scoreB: board.scoreB,
          },
        },
      };
    case "timeout":
      return { ...base, timeout: { hand: "left" } };
    case "keymoment":
      return { ...base, keyMoment: { hand: "left", text: "MATCH POINT" } };
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
    "sub", "challenge", "review", "success", "fail", "timeout", "keymoment",
  ];
  return all.find((d) => d === raw) ?? null;
}
