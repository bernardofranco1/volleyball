"use client";

/**
 * The motion layer (spec/48): the pieces of the score bug that MOVE.
 *
 * Everything here is a client overlay drawn in TvViewer's third SVG layer, above
 * the bar. It exists as a separate layer because `ScoreBug` is pure — no hooks,
 * no window, no clock, identical on the server (ScoreBug.tsx:19-21) — and an
 * animation needs an element that survives the value change that triggered it.
 * So the bug hides its own score digits and its own serve ball once the browser
 * has hydrated (see useHydrated) and these draw them instead, with the very same
 * `Cell` and the very same artwork at the very same coordinates.
 *
 * Every animation is WAAPI rather than CSS, for one reason: WAAPI can be
 * CANCELLED. A score that jumps twice inside 650 ms and a side-out that answers
 * another side-out are both normal, and a CSS transition has no way to be told
 * to start over.
 *
 * All of it gates on prefersReducedMotion(): the states jump and the layout is
 * identical, because none of this motion carries information.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  MOTION,
  NO_ROLL,
  ROLL_CLIP,
  ballFlightFrames,
  contentInFrames,
  driftFor,
  fadeOutFrames,
  prefersReducedMotion,
  resumeFrom,
  resumeInFrames,
  rollInFrames,
  rollOutFrames,
  rollReduce,
  serveFlip,
  slideInFrames,
  slideOutFrames,
  tickFrames,
  type ComputedNow,
  type Hidden,
  type RollState,
  type ServeFrame,
} from "@/lib/tv/motion";
import { DOCK, type Hand } from "@/lib/tv/extension-geometry";
import { ART, FRAME, TEXT } from "@/lib/tv/bug-geometry";
import type { Side } from "@/lib/tv/derive";
import { Cell } from "@/components/tv/ScoreBug";
import { ChallengeCard, type CardProps } from "@/components/tv/BugExtensions";

/** A rolling digit is transformed against its OWN box, not the viewBox. */
const FILL_BOX: React.CSSProperties = { transformBox: "fill-box" };

/**
 * What the browser says an element looks like this instant, including whatever
 * a filling animation is contributing (spec/48.1 F2).
 *
 * The one DOM read in this file that is not a write. Kept to the two properties
 * this motion animates so the decision it feeds — `resumeFrom` — stays a pure
 * function of two strings and can be tested without a browser.
 */
function computedNow(el: Element): ComputedNow | null {
  if (typeof window === "undefined" || !window.getComputedStyle) return null;
  const cs = window.getComputedStyle(el);
  return { transform: cs.transform, opacity: cs.opacity };
}

/**
 * One game-score cell as an odometer (spec/48 M2).
 *
 * The new value rolls in from above and the old one falls away below; a DECREMENT
 * mirrors both, so an undo or an overturned challenge reads as the wheel turning
 * back. Direction, and the rule that a multi-point jump is ONE roll to the final
 * value, are decided by `rollReduce` and tested there.
 *
 * The outgoing digit is a clone of the live one — not a hand-built element —
 * which is what keeps the two glyphs identical in font, size, position and
 * transform box without a second copy of any of that.
 */
export function RollingCell({ side, value }: { side: "left" | "right"; value: number }) {
  const live = useRef<SVGTextElement>(null);
  const roll = useRef<RollState>(NO_ROLL);
  const clipId = `tv-roll-clip-${side}`;
  const cx = side === "left" ? TEXT.score.lcx : TEXT.score.rcx;

  useLayoutEffect(() => {
    const next = rollReduce(roll.current, value);
    roll.current = next;
    const el = live.current;
    const parent = el?.parentNode as SVGGElement | null | undefined;
    if (!el || !parent || next.outgoing === null) return;
    if (prefersReducedMotion()) return;

    // RE-ARM, don't stack. Cancel what the live digit is doing and HARD REMOVE
    // any digit still on its way out: two points inside one roll's 650 ms is
    // ordinary, and three digits sliding past each other reads as a fault.
    el.getAnimations().forEach((a) => a.cancel());
    parent.querySelectorAll("[data-tv-outgoing]").forEach((n) => n.remove());

    const outgoing = el.cloneNode(true) as SVGTextElement;
    outgoing.setAttribute("data-tv-outgoing", "");
    outgoing.textContent = String(next.outgoing);
    parent.insertBefore(outgoing, el);

    const out = outgoing.animate(rollOutFrames(next.dir), {
      duration: MOTION.roll.duration,
      easing: MOTION.roll.out,
    });
    out.onfinish = () => outgoing.remove();
    el.animate(rollInFrames(next.dir), {
      duration: MOTION.roll.duration,
      easing: MOTION.roll.in,
    });
  }, [value]);

  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={cx - ROLL_CLIP.halfW}
            y={ROLL_CLIP.y}
            width={ROLL_CLIP.halfW * 2}
            height={ROLL_CLIP.h}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <Cell
          t={TEXT.score}
          side={side}
          value={String(value)}
          nodeRef={live}
          style={FILL_BOX}
        />
      </g>
    </>
  );
}

/**
 * The serve ball, and its V-flight across the bar on a side-out (spec/48 M1).
 *
 * The ball dives from the other slot, bounces 58 px below the resting line at
 * the mirror axis with half a spin in, and rises decelerating into its new slot
 * with the second half — 850 ms, single vertex. The departure point is the
 * destination MIRRORED about the axis rather than a rect read off the element,
 * because a rect can be captured mid-flight and then a quick second side-out
 * flies same-side → vertex → same-side instead of crossing (beach commit
 * 0f72e61). Nothing here measures anything.
 *
 * Absent, not dimmed, when nobody is serving — the same rule the bug follows,
 * for the same reason: between sets the feed says nothing about serve and
 * inventing a side would be a lie on air.
 */
export function ServeBallFlight({
  serving,
  set,
  hand,
}: {
  serving: Side | null;
  /** The set in progress: a ball changing hands at a set start is not a side-out. */
  set: number | null;
  /** Which feed side stands on which side of the picture. */
  hand: Record<"left" | "right", Side>;
}) {
  const ball = useRef<SVGImageElement>(null);
  const prev = useRef<ServeFrame | null>(null);

  const servingHand = serving === null ? null : serving === hand.left ? "left" : "right";
  const restX = servingHand === "right" ? ART.ball.rx : ART.ball.lx;

  useLayoutEffect(() => {
    const flip = serveFlip(prev.current, { side: serving, set });
    prev.current = { side: serving, set };
    const el = ball.current;
    if (!flip || !el) return;
    if (prefersReducedMotion()) return;
    // Cancel FIRST. Everything after this is arithmetic on constants, so there
    // is nothing to measure — but a second flight must still replace the first
    // rather than compose with it.
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(ballFlightFrames(restX), { duration: MOTION.ball.duration });
  }, [serving, set, restX]);

  if (servingHand === null) return null;
  return (
    <image
      ref={ball}
      href={"/tv-gfx/bug-ball.png"}
      x={restX}
      y={ART.ball.y}
      width={ART.ball.w}
      height={ART.ball.h}
      preserveAspectRatio="none"
      // fill-box + centre so the spin turns the ball on its own axis; the
      // default (view-box) would swing it around the middle of the frame.
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
    />
  );
}

// ── the panels ───────────────────────────────────────────────────────────────

/**
 * Any docked panel, sliding out from under the bar and back again (spec/48
 * M3/M4/M5).
 *
 * Two nested groups and the nesting is load-bearing: an element's own transform
 * establishes the user space its `clip-path` is resolved in, so a reveal clip on
 * the group that MOVES would move with it and clip nothing. The outer group
 * holds the clip and never moves; the inner one is what animates.
 *
 * The reveal clip is needed at all because "hidden under the bar" is only true
 * for the part of a panel that is INSIDE the bar's own band. The substitution
 * block's upper row sits at y 894-938, above the bar, where there is nothing to
 * hide behind — so everything on the bug's side of the docking edge is clipped
 * away, and the panel emerges from that edge exactly as it emerges from under
 * the bar below it. This is spec/48 G1's documented fallback, used here for the
 * one case the paint order cannot cover.
 *
 * The content step (`data-tv-content` on any descendant) starts 160 ms after the
 * plate and drifts in from the bug's direction. It is nested inside the moving
 * group, so it rides the plate and adds its own drift on top — which is why it
 * needs `fill: "backwards"`: without it the content would be fully visible
 * during its own delay, and there would be no two-step at all.
 */
export function MotionGroup({
  panel,
  hidden,
  enter,
  exit,
  leaving,
  fade = false,
  reveal,
  tick,
  children,
}: {
  /**
   * Which graphic this is — "sub", "km", "to", "alert", "card".
   *
   * It names the reveal clip. Two panels can dock to the SAME hand (a key
   * moment and a substitution both arrive on the left), and an id minted from
   * the hand alone would then exist twice in one document, where the second
   * `<clipPath>` is dead markup and every `url(#…)` resolves to the first
   * (spec/48.1 F4).
   */
  panel: string;
  hidden: Hidden;
  enter: { duration: number; easing: string };
  exit: { duration: number; easing: string };
  /** From usePresence: the director has dropped this graphic. */
  leaving: boolean;
  /** Fade with the movement — the centred challenge card, which docks to nothing. */
  fade?: boolean;
  /** Clip everything on the bug's side of this hand's docking edge. */
  reveal?: Hand;
  /**
   * A value whose CHANGE ticks the opacity of any `data-tv-tick` descendant —
   * a time-out pip being struck through while the tab is already up.
   */
  tick?: number;
  children: ReactNode;
}) {
  const group = useRef<SVGGElement>(null);
  const clipId = reveal ? `tv-reveal-${panel}-${reveal}` : null;

  useLayoutEffect(() => {
    const el = group.current;
    if (!el || prefersReducedMotion()) return;
    const content = [...el.querySelectorAll("[data-tv-content]")] as SVGGraphicsElement[];
    // Where the plate is RIGHT NOW, read BEFORE anything is cancelled: a
    // graphic that comes back mid-exit resumes from there. Cancelling first and
    // entering from `hidden` is a snap backwards to under the bar — the plate
    // is somewhere in between, and the eye follows a plate (spec/48.1 F2).
    const resume = leaving ? null : resumeFrom(computedNow(el), fade);
    for (const target of [el, ...content]) {
      target.getAnimations().forEach((a) => a.cancel());
    }

    if (!leaving) {
      el.animate(resume ? resumeInFrames(resume, fade) : slideInFrames(hidden, fade), {
        ...enter,
        fill: "backwards",
      });
      const drift = driftFor(hidden);
      for (const c of content) {
        c.animate(contentInFrames(drift), {
          ...MOTION.content.enter,
          delay: MOTION.content.delay,
          fill: "backwards",
        });
      }
      return;
    }
    // Leaving: the content goes first and faster, while the plate is still on
    // its way back under the bar. `fill: forwards` because the element outlives
    // its animation by the frame or two before presence unmounts it.
    el.animate(slideOutFrames(hidden, fade), { ...exit, fill: "forwards" });
    for (const c of content) {
      c.animate(fadeOutFrames(), { ...MOTION.content.exit, fill: "forwards" });
    }
    // The timings and the hidden offset are constants for the life of a panel;
    // re-running on their object identity would restart the animation on every
    // render, which is the one thing this must never do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // A tick is a state change WITHIN a panel that is already up, so it must not
  // run on the way in — the strike is part of the entrance then.
  const firstTick = useRef(true);
  useLayoutEffect(() => {
    const el = group.current;
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    if (!el || prefersReducedMotion()) return;
    for (const t of el.querySelectorAll("[data-tv-tick]")) {
      (t as SVGGraphicsElement).animate(tickFrames(), { duration: MOTION.tab.strike });
    }
  }, [tick]);

  return (
    <g clipPath={clipId ? `url(#${clipId})` : undefined}>
      {clipId ? (
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <rect
              x={reveal === "left" ? 0 : DOCK.right}
              y={0}
              width={reveal === "left" ? DOCK.left : FRAME.w - DOCK.right}
              height={FRAME.h}
            />
          </clipPath>
        </defs>
      ) : null}
      {/* `data-tv-motion` is not decoration: it is what the browser QA harness
          samples to prove a panel actually travelled rather than merely being
          armed. */}
      <g ref={group} data-tv-motion>
        {children}
      </g>
    </g>
  );
}

/**
 * The challenge card, and its verdict hand-off (spec/48 M5).
 *
 * REVIEW → SUCCESSFUL is a 350 ms crossfade between two STACKED plates rather
 * than a swap: the navy review card stays where it is and the verdict card —
 * accent blue or brand red — fades in over it. Animating opacity and not the
 * plate's fill is the point; a gradient interpolating from navy to red goes
 * through colours that are not in the package.
 *
 * The two cards are sized to their own headers, so they are genuinely two
 * different shapes and each needs its own gradient and clip ids — hence
 * `idSuffix`, which is the only reason ChallengeCard knows this exists.
 */
export function ChallengeCardStack({ card }: { card: CardProps }) {
  const [stack, setStack] = useState<{ over: CardProps; under: CardProps | null }>({
    over: card,
    under: null,
  });
  if (stack.over !== card) {
    // Derived during render, like usePresence: the crossfade must be armed in
    // the same commit the new verdict appears, not a frame later.
    setStack({ over: card, under: stack.over });
  }
  const over = useRef<SVGGElement>(null);
  const under = stack.over === card ? stack.under : stack.over;

  useLayoutEffect(() => {
    if (!under) return;
    const el = over.current;
    if (el && !prefersReducedMotion()) {
      el.animate(tickFrames(), { duration: MOTION.card.verdict, fill: "backwards" });
    }
    const done = setTimeout(
      () => setStack((s) => (s.under ? { over: s.over, under: null } : s)),
      prefersReducedMotion() ? 0 : MOTION.card.verdict,
    );
    return () => clearTimeout(done);
  }, [under]);

  return (
    <>
      {under ? <ChallengeCard {...under} idSuffix="-under" /> : null}
      <g ref={over}>
        <ChallengeCard {...card} idSuffix="-over" />
      </g>
    </>
  );
}
