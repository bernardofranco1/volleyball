/**
 * How often a board asks VIS for a new payload (spec/37).
 *
 * The rule is one number in one place, used by all three layers that could
 * otherwise disagree and add their own latency on top of each other: the
 * browser's poll timer, the server-side store's TTL, and the CDN's s-maxage.
 *
 * Nothing polls unless a board is open. There is no cron, no warmer and no
 * background refresh: the store is filled by a request from a screen that
 * somebody is looking at, and it goes cold on its own when the last one closes.
 *
 * Why one second while a set is on: a venue scoreboard is read against the
 * court, and a point that appears three seconds after the crowd reacts to it
 * looks broken. FIVB have confirmed one request per second per match is not a
 * problem for VIS, so during play we deliberately poll faster than the feed's
 * own advisory `PollDelay` — but ONLY during play. In a set break, before the
 * first whistle and after the match nothing changes second to second, so those
 * states back off hard and the feed's own delay is honoured as a floor.
 *
 * The cadence bounds UPSTREAM traffic, not viewer traffic: any number of TVs on
 * one match share a single in-flight call and a single cached payload, so a
 * venue with eight screens costs VIS exactly what one screen costs.
 */

import type { VisBoardData } from "./board-data";

/** A set is being played: as live as the feed can be read. */
export const LIVE_MS = 1_000;
/** Between sets — the score is settled and the next set has not started. */
export const BREAK_MS = 5_000;
/** Before the first whistle. Short enough to catch the start promptly. */
export const UPCOMING_MS = 10_000;
/** Match over. The board still refreshes in case a result is corrected. */
export const FINISHED_MS = 30_000;
/**
 * While a rally is IN PROGRESS on a VolleyStation-sourced board.
 *
 * VolleyStation says `widget.in_rally` outright, so we know a point is about to
 * land and can ask more often for the seconds it matters, then fall back to the
 * ordinary live cadence between rallies. The average request rate barely moves;
 * what moves is the delay at the only moment anyone is watching the number.
 *
 * Applied to VolleyStation only. VIS has no equivalent signal, and spec/37
 * records FIVB confirming ONE request per second per match — an agreement that
 * is not ours to change unilaterally, however cheap the Version handshake has
 * since made a quiet poll (114 bytes). If they are willing, `LIVE_MS` is the
 * single lever, and the payload cost would still be lower than it was before
 * the handshake existed.
 */
export const VS_IN_RALLY_MS = 400;

/**
 * The poll interval for a board in this state, in milliseconds.
 *
 * `respectPollDelay` applies the feed's own advisory delay as a FLOOR. The
 * server store passes true for every state except live play, so a quiet board
 * never asks more often than VIS suggests; the live case is the documented,
 * authorised exception.
 */
export function pollIntervalMs(
  board: Pick<VisBoardData, "status" | "inSetBreak" | "pollDelaySeconds">,
): number {
  if (board.status === "FINISHED") return atLeastFeedDelay(FINISHED_MS, board);
  if (board.status === "UPCOMING") return atLeastFeedDelay(UPCOMING_MS, board);
  if (board.inSetBreak) return atLeastFeedDelay(BREAK_MS, board);
  return LIVE_MS;
}

function atLeastFeedDelay(
  ms: number,
  board: Pick<VisBoardData, "pollDelaySeconds">,
): number {
  return Math.max(ms, (board.pollDelaySeconds ?? 0) * 1000);
}

/**
 * What the CDN may serve without asking the origin, in seconds. One second
 * behind the poll cadence, floored at 1: shorter than the cadence would make
 * the cache pointless, longer would add its own staleness on top of the store's.
 */
export function cdnMaxAgeSeconds(intervalMs: number): number {
  return Math.max(1, Math.floor(intervalMs / 1000));
}

/**
 * The `Cache-Control` a board response carries.
 *
 * `stale-while-revalidate` is the right tool for a quiet board and the wrong
 * one for a live set. Measured on a live match on 2026-08-20, the edge answered
 * `x-vercel-cache: STALE` on four reads out of six — and at
 * `s-maxage=1, stale-while-revalidate=2` it is entitled to hand a venue screen
 * a score up to THREE seconds old while it refreshes behind. That was the
 * largest single slice of the delay between a point being scored and the number
 * changing in the hall.
 *
 * So while a set is being played there is no stale window: the edge revalidates
 * on expiry, which costs that one request our own ~50-200 ms instead of seconds
 * of wrong score. Everywhere else — upcoming, between sets, finished — nothing
 * is moving and the stale window is free, so it stays.
 */
export function boardCacheControl(
  board: Pick<VisBoardData, "status" | "inSetBreak">,
  intervalMs: number,
): string {
  const maxAge = cdnMaxAgeSeconds(intervalMs);
  const live = board.status === "LIVE" && !board.inSetBreak;
  return live
    ? `public, s-maxage=${maxAge}, stale-while-revalidate=0`
    : `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`;
}
