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
import { TEXT } from "@/lib/tv/bug-geometry";
import {
  MOTION,
  NO_ROLL,
  ROLL_CLIP,
  prefersReducedMotion,
  rollInFrames,
  rollOutFrames,
  rollReduce,
  type RollState,
} from "@/lib/tv/motion";
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
