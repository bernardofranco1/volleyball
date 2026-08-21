"use client";

/**
 * Keep a dropped graphic mounted long enough for it to leave (spec/48 G2).
 *
 * The spec/47 extensions are bare ternaries in TvViewer: the frame the director
 * stops returning a substitution is the frame it vanishes from the tree, so
 * there is nothing on screen to animate out of. This is the whole fix — no
 * library, one deadline. The decision itself is a pure reducer in motion.ts,
 * which is where its tests are.
 *
 * Two things about the shape of it:
 *
 *  - **The state is adjusted during RENDER, not in an effect.** React's own
 *    "adjusting state when a prop changes" pattern: it re-renders before it
 *    paints, so a graphic never gets a frame in the wrong state, and it keeps
 *    the effect below doing what effects are for — owning a timer.
 *  - **SSR-safe by construction.** The first state IS the incoming value, so the
 *    server renders exactly what it rendered before this existed (spec/48 §0.3).
 */

import { useEffect, useState } from "react";
import {
  noPresence,
  prefersReducedMotion,
  presenceReduce,
  type PresenceState,
} from "./motion";

export interface Presence<T> {
  /** What to render — the incoming value, or the last one while it leaves. */
  value: T | null;
  /** On screen, on its way out. The wrapper reads true → false as "re-enter". */
  leaving: boolean;
}

export function usePresence<T>(incoming: T | null, exitMs: number): Presence<T> {
  const [state, setState] = useState<PresenceState<T>>(() => ({
    value: incoming,
    leaving: false,
  }));

  // Under reduced motion there is no exit to wait for, so the graphic simply
  // goes — the state jumps, which is the house fallback everywhere.
  const exit = prefersReducedMotion() ? 0 : exitMs;
  const next = presenceReduce(state, incoming, exit);
  if (next !== state) setState(next);

  const leaving = next.leaving;
  useEffect(() => {
    if (!leaving) return;
    // The only clock in the whole mechanism, and it starts the moment the state
    // says "leaving" — which is the same render that arms the exit animation.
    const id = setTimeout(() => setState(noPresence<T>()), exit);
    return () => clearTimeout(id);
  }, [leaving, exit]);

  return { value: next.value, leaving: next.leaving };
}
