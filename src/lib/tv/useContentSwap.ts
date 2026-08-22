"use client";

/**
 * Change what a plate carries without retracting the plate (spec/48.1 F1).
 *
 * `usePresence` is the same idea one level up: it keeps a dropped graphic
 * mounted long enough to slide away. This keeps the OLD content mounted long
 * enough to fade, while the panel it sits on stays exactly where it is — which
 * is what a pair of substitutions on one side needs, because the director
 * announces the second in the same tick it drops the first and the graphic
 * therefore never leaves the screen to come back.
 *
 * It sits between the director and presence:
 *
 *     graphics.substitution → useContentSwap → usePresence → MotionGroup
 *
 * so presence sees the value this hook is holding, and the plate stays out for
 * the whole hand-over. The decision is a pure reducer in motion.ts, which is
 * where its tests are; the only thing here is the deadline.
 */

import { useEffect, useState } from "react";
import {
  MOTION,
  prefersReducedMotion,
  swapCommit,
  swapReduce,
  type PanelId,
  type SwapPhase,
  type SwapState,
} from "./motion";

export interface ContentSwap<T> {
  /** What to render: the outgoing content while it fades, then the new one. */
  value: T | null;
  /** What the panel's content step should be doing, if anything. */
  phase: SwapPhase;
}

export function useContentSwap<T>(
  incoming: T | null,
  id: (value: T) => PanelId,
): ContentSwap<T> {
  // Under reduced motion there is no fade to wait for, so the content jumps —
  // the house fallback, and `swapReduce` reads a zero as exactly that.
  const out = prefersReducedMotion() ? 0 : MOTION.content.exit.duration;

  // The first state IS the incoming value: the server renders what it rendered
  // before this existed (spec/48 §0.3), and a swap can only ever be a second
  // frame's news.
  const [state, setState] = useState<SwapState<T>>(() => ({
    value: incoming,
    queued: null,
    phase: null,
  }));

  // Adjusted during render, like usePresence: React re-renders before it
  // paints, so the content never gets a frame in the wrong phase.
  const next = swapReduce(state, incoming, id, out);
  if (next !== state) setState(next);

  const waiting = next.queued !== null;
  useEffect(() => {
    if (!waiting) return;
    const done = setTimeout(() => setState(swapCommit), out);
    return () => clearTimeout(done);
  }, [waiting, out]);

  return { value: next.value, phase: next.phase };
}
