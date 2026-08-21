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

import { useLayoutEffect, useRef } from "react";
import { ART, TEXT } from "@/lib/tv/bug-geometry";
import {
  MOTION,
  NO_ROLL,
  ROLL_CLIP,
  ballFlightFrames,
  prefersReducedMotion,
  rollInFrames,
  rollOutFrames,
  rollReduce,
  serveFlip,
  type RollState,
  type ServeFrame,
} from "@/lib/tv/motion";
import type { Side } from "@/lib/tv/derive";
import { Cell } from "@/components/tv/ScoreBug";

/** A rolling digit is transformed against its OWN box, not the viewBox. */
const FILL_BOX: React.CSSProperties = { transformBox: "fill-box" };

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
