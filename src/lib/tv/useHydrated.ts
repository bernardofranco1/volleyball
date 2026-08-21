"use client";

/**
 * True once this browser has hydrated, false on the server and in the hydrating
 * render (spec/48).
 *
 * The motion overlay must not exist in the server's output: the e2e first-frame
 * assertion and both browser gates measure what the page paints before any of
 * our JavaScript has had an opinion, and spec/48 §0.3 makes that output a
 * contract. So the animated digits and the animated ball are mounted only after
 * hydration, and the static ones in `ScoreBug` are hidden in the SAME commit —
 * one flag drives both, so there is never a frame with two of either, or none.
 *
 * `useSyncExternalStore` with a server snapshot of `false` rather than a state
 * flag set from an effect: it is React's own answer to this question, and it
 * keeps the flip inside the render pass instead of behind a cascading render.
 */

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: the answer changes exactly once, at hydration. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}
