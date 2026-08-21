/**
 * The graphics delay, and its bounds (spec/47).
 *
 * A module of its own, and that is not tidiness. This constant lives here
 * because it is read by BOTH a server component (the output page, clamping
 * `?delay=`) and client components (the launcher's slider, the viewer's
 * hotkeys) — and it used to live in useDelayedBoard.ts, which carries a
 * "use client" directive.
 *
 * Importing a plain value out of a "use client" module into a Server Component
 * does not give you the value. It gives you a client reference, and
 * `Math.min(clientReference, 0)` is NaN — which sailed through TypeScript, made
 * the clamp return NaN, and left the delayed board resolving to the FIRST frame
 * in the buffer for the rest of the match. The graphics simply stopped
 * updating, silently, with no error anywhere near the cause. The only visible
 * symptom was a React warning about a NaN `value` on the operator panel's
 * slider, one component away.
 */

/** How far back the delay buffer can serve. Past any sane HLS latency. */
export const MAX_DELAY_S = 60;

/** A starting point, not a setting: HLS is usually in this region. */
export const DEFAULT_DELAY_S = 12;

/** Half-second steps, which is what the `[` and `]` keys nudge by. */
export const DELAY_STEP_S = 0.5;

/** `?delay=` or a slider value → a usable number of seconds. */
export function clampDelay(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_DELAY_S, n));
}
