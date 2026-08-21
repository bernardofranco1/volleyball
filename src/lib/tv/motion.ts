/**
 * The TV overlay's motion, as numbers and as decisions (spec/48).
 *
 * Two kinds of thing live here and neither of them touches the DOM:
 *
 *  1. **The approved constants.** Every duration and easing below was reviewed
 *     live against a WAAPI demo page and approved by the owner on 2026-08-21
 *     (spec/48 §1). They are a CONTRACT, not defaults: nothing here may be
 *     tuned to taste, and `tv-motion.test.ts` asserts the numbers so a tidy-up
 *     cannot quietly re-time the package. The philosophy behind them is worth
 *     keeping in mind when adding a new one — deliberate rather than rushed, and
 *     exits always faster than entrances.
 *  2. **The decisions.** Whether a serve change is a side-out, which way an
 *     odometer rolls, and how long a graphic that has just been dropped stays
 *     mounted. All pure reducers over a previous value, because that is the only
 *     way to test motion logic without a browser: the animation itself is three
 *     lines of WAAPI, and every bug in it is in deciding WHEN to run it.
 *
 * The components that use these are in src/components/tv/BugMotion.tsx. The
 * score bug itself stays pure (spec/48 §0.1): it never imports this file.
 */

import { ART, AXIS, BAR } from "./bug-geometry";
import type { Side } from "./derive";

/**
 * The house reduced-motion gate (the pattern in BroadcastBoard.tsx:49-54).
 *
 * Every animation in this feature is behind it, and the fallback is always the
 * same one: the state jumps and the layout is identical. Nothing here is load
 * bearing for legibility — the graphics are complete at rest.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** OWNER-APPROVED, verbatim from spec/48 §1. Do not tune. */
export const MOTION = {
  /** M1 · the serve ball's V-flight on a side-out. */
  ball: {
    duration: 850,
    /** How far below the resting line the vertex dips, at the axis. */
    dip: 58,
    /** The dive down to the vertex, then the decelerating rise out of it. */
    dive: "cubic-bezier(.55,0,.85,.5)",
    bounce: "cubic-bezier(.15,.5,.4,1)",
    /** Squash at the vertex only. */
    squash: { x: 1.15, y: 0.85 },
  },
  /** M2 · the score odometer. */
  roll: {
    duration: 650,
    /** Percent of the digit's own box the outgoing value travels. */
    travel: 115,
    out: "cubic-bezier(.5,0,.7,.4)",
    in: "cubic-bezier(.25,.5,.25,1)",
  },
  /** M3 · the outward slide every docked panel makes. */
  slide: {
    /** Hidden position, in design px, measured from the docking edge. */
    hidden: 410,
    enter: { duration: 650, easing: "cubic-bezier(.16,.84,.28,1)" },
    exit: { duration: 480, easing: "cubic-bezier(.55,.06,.68,.19)" },
  },
  /** M3 · the second step: the content a plate carries. */
  content: {
    /** After the plate starts, not after it lands. */
    delay: 160,
    /** Drift, in design px, from the bug's direction. */
    drift: 26,
    enter: { duration: 420, easing: "cubic-bezier(.2,.7,.25,1)" },
    /** Out first, while the plate is still sliding back under the bar. */
    exit: { duration: 260, easing: "linear" },
  },
  /** M4 · the tabs, which rise out of the bar rather than slide along it. */
  tab: {
    /** Hidden position, in design px, DOWN into the bar's band. */
    hidden: 36,
    enter: { duration: 450, easing: "cubic-bezier(.2,.8,.3,1)" },
    exit: { duration: 360, easing: "ease-in" },
    /** A pip being struck through is an opacity tick, not a movement. */
    strike: 260,
  },
  /** M5 · the challenge card's hand-off with the bug. */
  card: {
    /** Hidden position, in design px, DOWN. */
    hidden: 40,
    enter: { duration: 320, easing: "cubic-bezier(.2,.8,.3,1)" },
    exit: { duration: 320, easing: "cubic-bezier(.4,0,.7,.2)" },
    /** REVIEW → verdict, as two stacked plates crossfading. */
    verdict: 350,
  },
  /**
   * The bug's own fade, which is not ours: it is the CSS transition already on
   * ScoreBug (ScoreBug.tsx:71) and the card is timed against it.
   */
  bugFade: 180,
} as const;

// ── M1: is this a side-out? ──────────────────────────────────────────────────

/** What the flight needs to know about a frame: who serves, and in which set. */
export interface ServeFrame {
  side: Side | null;
  set: number | null;
}

/**
 * A genuine A↔B flip of the serving side between two DELAYED frames, or null.
 *
 * Four things are deliberately not a side-out, and each of them would otherwise
 * fly the ball across the bar for no reason:
 *
 *  - **mount** — there is no previous frame, so there is no flight;
 *  - **unchanged** — the common case, four times a second;
 *  - **serve null** — between sets and before the first whistle the bug draws NO
 *    ball (ScoreBug.tsx:137), so a flight would depart from an empty slot. The
 *    null frame still lands in the ref, which is what makes the first serve of a
 *    set a mount rather than a flip;
 *  - **a new set** — the ball changes hands at a set start, but that is a new
 *    serve rather than a side-out, and the previous set's ball is long gone from
 *    the screen. Guarded on the set number as well as on the null gap, because a
 *    poll can straddle a set boundary and never report the gap.
 */
export function serveFlip(
  prev: ServeFrame | null,
  next: ServeFrame,
): { from: Side; to: Side } | null {
  if (!prev || prev.side == null || next.side == null) return null;
  if (prev.set !== next.set) return null;
  if (prev.side === next.side) return null;
  return { from: prev.side, to: next.side };
}

/**
 * Where the ball departs from, mirrored about the bug's axis.
 *
 * The destination is a CONSTANT (`ART.ball`), and the departure is that constant
 * reflected — never a measured rect. Beach learned this the hard way (commit
 * `0f72e61`): a rect recorded from the live element can be captured
 * mid-animation, and a quick second side-out then flies same-side → vertex →
 * same-side instead of crossing. There is nothing to measure here at all, which
 * is strictly better than measuring carefully.
 */
export function mirrorDepartureX(restX: number, width: number, axis = AXIS): number {
  return 2 * axis - restX - width;
}

/**
 * The V-flight, as a WAAPI keyframe array. `restX` is the ball's own x.
 *
 * THREE KEYFRAMES — SINGLE VERTEX. A contact-dwell variant (extra keyframes
 * holding the ball at the vertex) was demoed to the owner and REJECTED: it broke
 * the flight. Do not reintroduce it; `tv-motion.test.ts` counts the keyframes.
 */
export function ballFlightFrames(restX: number): Keyframe[] {
  const { dip, dive, bounce, squash } = MOTION.ball;
  const w = ART.ball.w;
  const fromX = mirrorDepartureX(restX, w) - restX;
  const midX = AXIS - w / 2 - restX;
  return [
    {
      transform: `translate(${fromX}px, 0) rotate(0deg)`,
      easing: dive,
    },
    {
      transform: `translate(${midX}px, ${dip}px) rotate(180deg) scale(${squash.x},${squash.y})`,
      offset: 0.5,
      easing: bounce,
    },
    { transform: "translate(0,0) rotate(360deg)" },
  ];
}

// ── M2: the odometer ─────────────────────────────────────────────────────────

/**
 * The window a rolling digit is visible through, per game-score cell.
 *
 * DERIVED from the bar, not measured: one design pixel inside the band top and
 * bottom, so a digit on its way in is hidden by the bar's own top edge and
 * appears to come from behind it. Wide enough for two digits with room to spare
 * — the cell is centred on its ADVANCE box (bug-geometry.ts:148-157), so 9 → 10
 * re-centres the pair inside this window rather than growing out of it.
 */
export const ROLL_CLIP = {
  halfW: 56,
  y: BAR.y + 1,
  h: BAR.h - 2,
} as const;

/** Which way a roll runs: 1 = the new value arrives from ABOVE. */
export type RollDir = 1 | -1;

export interface RollState {
  /** The value on screen. */
  value: number | null;
  /** The value rolling out of frame, if one is. */
  outgoing: number | null;
  dir: RollDir;
}

export const NO_ROLL: RollState = { value: null, outgoing: null, dir: 1 };

/**
 * Advance the odometer to `next`.
 *
 * Two rules that are the whole reason this is a reducer and not four lines in an
 * effect:
 *
 *  - **Direction follows the SIGN.** An increment rolls in from above; a
 *    decrement rolls back from below. Decrements are real — an undo, and a
 *    challenge overturned in the other team's favour, both take a point off.
 *  - **Re-arm, don't stack.** A leftover outgoing value is DISCARDED rather than
 *    left to finish, so a multi-point jump arriving in one poll (12 → 15, which
 *    a slow feed does produce) is ONE roll to the final value and not three
 *    digits sliding past each other. The beach board learned this too
 *    (BroadcastBoard.tsx:213-214).
 */
export function rollReduce(state: RollState, next: number): RollState {
  if (state.value === null) return { value: next, outgoing: null, dir: 1 };
  if (state.value === next) return { ...state, outgoing: null };
  return {
    value: next,
    outgoing: state.value,
    dir: next > state.value ? 1 : -1,
  };
}

/** The outgoing digit's keyframes: away in the direction of travel, fading. */
export function rollOutFrames(dir: RollDir): Keyframe[] {
  return [
    { transform: "translateY(0)", opacity: 1 },
    { transform: `translateY(${dir * MOTION.roll.travel}%)`, opacity: 0 },
  ];
}

/** The incoming digit's keyframes: in from the opposite side, no fade. */
export function rollInFrames(dir: RollDir): Keyframe[] {
  return [
    { transform: `translateY(${dir * -MOTION.roll.travel}%)` },
    { transform: "translateY(0)" },
  ];
}

// ── M3/M4/M5: the panels ─────────────────────────────────────────────────────

/** Where a docked panel hides, in design px, from where it comes to rest. */
export interface Hidden {
  /** Along the bar, toward the bug — under the flag and the plate (M3). */
  x?: number;
  /** Down into the bar's own band, where the bug covers it (M4, M5). */
  y?: number;
}

function translate(h: Hidden): string {
  return `translate(${h.x ?? 0}px, ${h.y ?? 0}px)`;
}

/**
 * A panel arriving from under the bar. `fade` is for the challenge card, which
 * is the one graphic that is not docked to anything and so has no edge to appear
 * from — it rises and fades instead (M5).
 */
export function slideInFrames(hidden: Hidden, fade = false): Keyframe[] {
  return [
    { transform: translate(hidden), ...(fade ? { opacity: 0 } : {}) },
    { transform: "translate(0px, 0px)", ...(fade ? { opacity: 1 } : {}) },
  ];
}

/** And leaving again, the same way it came. */
export function slideOutFrames(hidden: Hidden, fade = false): Keyframe[] {
  return slideInFrames(hidden, fade).slice().reverse();
}

/**
 * The second step: what a plate CARRIES (M3).
 *
 * Shirts, names and arrows drift in from the bug's direction and fade up, 160 ms
 * after the plate starts to travel — so the plate is read as arriving first and
 * the content as landing on it, which is what the reference package does. The
 * jersey silhouettes ride this step and get no animation of their own: a
 * popping or spinning shirt was rejected as off-brand.
 */
export function contentInFrames(drift: Hidden): Keyframe[] {
  return [
    { transform: translate(drift), opacity: 0 },
    { transform: "translate(0px, 0px)", opacity: 1 },
  ];
}

/** Content leaves by fading only, while the plate is still sliding back. */
export function fadeOutFrames(): Keyframe[] {
  return [{ opacity: 1 }, { opacity: 0 }];
}

/** A pip being struck through, or any other one-off state tick (M4). */
export function tickFrames(): Keyframe[] {
  return [{ opacity: 0 }, { opacity: 1 }];
}

/**
 * How far the content drifts, and in which direction: from the bug, which is the
 * direction the panel itself came from.
 */
export function driftFor(hidden: Hidden): Hidden {
  const x = hidden.x ?? 0;
  const y = hidden.y ?? 0;
  return x !== 0
    ? { x: Math.sign(x) * MOTION.content.drift }
    : { y: Math.sign(y) * MOTION.content.drift };
}

// ── G2: presence ─────────────────────────────────────────────────────────────

/**
 * A graphic the director has dropped, kept alive long enough to leave.
 *
 * The spec/47 extensions are bare ternaries, which means nothing can animate
 * out: the moment the director stops returning a substitution the element is
 * gone from the tree. This is the smallest thing that fixes it — no library, no
 * context, one value and a deadline.
 */
export interface PresenceState<T> {
  value: T | null;
  /** On screen, but on its way out. */
  leaving: boolean;
}

export function noPresence<T>(): PresenceState<T> {
  return { value: null, leaving: false };
}

/**
 * Fold one frame into the presence state.
 *
 * Clock-free on purpose: this runs during render (see usePresence) and reading a
 * clock there is not idempotent. The deadline belongs to the timer, which is the
 * one thing an effect is genuinely for — the decisions are all here, and all of
 * them are about ORDER rather than about elapsed time.
 *
 * `incoming` non-null always wins immediately, including over a graphic that is
 * mid-exit: a substitution replacing a substitution has to come back rather than
 * finish leaving, and the wrapper reads `leaving` going true → false as "enter
 * again".
 */
export function presenceReduce<T>(
  state: PresenceState<T>,
  incoming: T | null,
  exitMs: number,
): PresenceState<T> {
  if (incoming !== null) {
    // Identity-stable when nothing has changed: this runs off a 4 Hz tick and a
    // fresh object every tick would re-render the whole overlay for nothing.
    if (state.value === incoming && !state.leaving) return state;
    return { value: incoming, leaving: false };
  }
  if (state.value === null) return state.leaving ? noPresence<T>() : state;
  // Nothing to animate out of when the exit is instant (reduced motion).
  if (exitMs <= 0) return noPresence<T>();
  return state.leaving ? state : { value: state.value, leaving: true };
}
