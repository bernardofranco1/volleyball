/**
 * VolleyStation payload → the board's view model (spec/45 W3).
 *
 * Output type is EXACTLY `VisBoardData`, so nothing downstream of the store can
 * tell the two sources apart: the pages, the U-shape, the cadence, the CDN
 * headers and the status page all keep working unchanged.
 *
 * What makes this mapper short where the VIS one is long: VolleyStation gives
 * us the scorer's CURRENT rotation directly (`widget.lineup_*`, six shirt
 * numbers, position 1 first — verified in spec/45 §3). There is no side-out to
 * derive, no rewrite window to absorb and no serve action to anchor on, because
 * we are reading the system that VIS is downstream of.
 *
 * Three things it must do that VIS does for us, and getting any of them wrong
 * puts the wrong name on an arena screen:
 *
 *  1. **Swap the libero in.** The lineup holds the ROTATION — the six
 *     registered players — while `libero_replacing_*` names whichever of them
 *     is currently off court and `libero_number_*` the libero standing there.
 *     VIS's per-rally lineup already has this applied; here we apply it.
 *  2. **Count allowances DOWN, not up.** `timeout_count` and friends are
 *     `[home, guest]` REMAINING (spec/45 §3 finding 5) — the inverse of VIS —
 *     so they are used as-is and never subtracted from a limit.
 *  3. **Take the limits from the championship**, not from `FIVB_PER_SET`: the
 *     observed FIVB events allow 8 substitutions, not 6.
 */

import {
  FIVB_PER_SET,
  type VisBoardData,
  type VisBoardPlayer,
  type VisBoardTeam,
  type VisBoardSet,
} from "@/lib/vis-live/board-data";
import type { VsChampionship, VsMatch, VsStatsRow, VsWidget } from "./types";

const SETS_TO_WIN_DEFAULT = 3;

export interface VsBoardInput {
  match: VsMatch;
  stats: VsStatsRow[] | null;
  config: VsChampionship | null;
  /** Shirt number → display name, per side. */
  rosterHome: Map<number, string> | null;
  rosterGuest: Map<number, string> | null;
  /** The VIS match number — the board's public identity stays VIS's. */
  matchNo: number;
  poolName?: string | null;
  tournamentName?: string | null;
  scheduledLocal?: string | null;
  now?: number;
}

/**
 * The six actually standing on court, in position order.
 *
 * `lineup` is the rotation; if a libero is on, they occupy the slot of the
 * player they replaced. A slot with no number yet (pre-lineup) drops out rather
 * than rendering as "#null".
 */
function sixOnCourt(
  lineup: (number | null)[] | null,
  liberoReplacing: number | null,
  liberoNumber: number | null,
  roster: Map<number, string> | null,
  points: Map<number, number>,
): VisBoardPlayer[] {
  if (!lineup) return [];
  const out: VisBoardPlayer[] = [];
  lineup.forEach((shirt, i) => {
    if (shirt == null) return;
    const isLiberoSlot =
      liberoReplacing != null && liberoNumber != null && shirt === liberoReplacing;
    const onCourt = isLiberoSlot ? liberoNumber : shirt;
    out.push({
      position: i + 1,
      jersey: onCourt,
      name: roster?.get(onCourt) ?? `#${onCourt}`,
      points: points.get(onCourt) ?? 0,
      isLibero: isLiberoSlot,
    });
  });
  return out;
}

/** Shirt number → match points, for one side of the stats sheet. */
function pointsBySide(rows: VsStatsRow[] | null, home: boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows ?? []) {
    if (r.is_home !== home) continue;
    const shirt = Number(r.Number);
    if (!Number.isFinite(shirt)) continue;
    const pts = Number(r.Points ?? 0);
    out.set(shirt, Number.isFinite(pts) ? pts : 0);
  }
  return out;
}

function sumBySide(rows: VsStatsRow[] | null, home: boolean, key: keyof VsStatsRow): number {
  let total = 0;
  for (const r of rows ?? []) {
    if (r.is_home !== home) continue;
    const n = Number(r[key] ?? 0);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Interruptions for one side, counted DOWN from what the feed reports as
 * REMAINING. When the feed carries no array (an un-started match), everything
 * is still full, so the championship's limits — or the FIVB ones — stand in.
 */
function interruptions(
  match: VsMatch,
  config: VsChampionship | null,
  side: 0 | 1,
  base: Pick<VisBoardTeam, "code" | "name" | "players">,
): VisBoardTeam {
  const limitTimeouts = config?.timeout_limit ?? FIVB_PER_SET.timeouts;
  const limitSubs = config?.substitutions_limit ?? FIVB_PER_SET.substitutions;
  const limitChallenges = config?.video_challenge_limit ?? FIVB_PER_SET.challenges;

  const remaining = (arr: number[] | null | undefined, fallback: number) => {
    const v = arr?.[side];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const timeoutsRemaining = remaining(match.timeout_count, limitTimeouts);
  const substitutionsRemaining = remaining(match.substitution_count, limitSubs);
  const challengesRemaining = remaining(match.challenge_count, limitChallenges);

  return {
    ...base,
    // "Used" is derived for the fields the board still exposes, and clamped at
    // zero: an event whose remaining count exceeds its own limit is a real
    // shape (spec/34 saw 4 used with 4 remaining), not something to normalise.
    timeoutsTaken: Math.max(0, limitTimeouts - timeoutsRemaining),
    substitutionsUsed: Math.max(0, limitSubs - substitutionsRemaining),
    challengesRefused: Math.max(0, limitChallenges - challengesRemaining),
    challengesRequested: Math.max(0, limitChallenges - challengesRemaining),
    timeoutsRemaining: Math.max(0, timeoutsRemaining),
    substitutionsRemaining: Math.max(0, substitutionsRemaining),
    challengesRemaining: Math.max(0, challengesRemaining),
  };
}

function setLadder(match: VsMatch, decided: boolean): VisBoardSet[] {
  const pairs: [number | null, number | null][] = [
    [match.Set1Home, match.Set1Guest],
    [match.Set2Home, match.Set2Guest],
    [match.Set3Home, match.Set3Guest],
    [match.Set4Home, match.Set4Guest],
    [match.Set5Home, match.Set5Guest],
  ];
  const current = match.widget?.current_set ?? 0;
  const out: VisBoardSet[] = [];
  pairs.forEach(([a, b], i) => {
    const scoreA = Number(a ?? 0);
    const scoreB = Number(b ?? 0);
    const setNumber = i + 1;
    const played = scoreA > 0 || scoreB > 0 || setNumber <= current;
    if (!played) return;
    const isCurrent = setNumber === current;
    // A set in play has no winner even at 25-23; a completed one does.
    const settled = !isCurrent || decided;
    out.push({
      setNumber,
      scoreA,
      scoreB,
      winner: settled && scoreA !== scoreB ? (scoreA > scoreB ? "A" : "B") : null,
    });
  });
  return out;
}

/** `GetVolleyLive`'s counterpart: a VolleyStation match → the board. */
export function mapVsBoard(input: VsBoardInput): VisBoardData {
  const { match, stats, config, matchNo } = input;
  const now = input.now ?? Date.now();
  const widget: VsWidget | null = match.widget;

  const setsToWin = config?.sets_to_win ?? SETS_TO_WIN_DEFAULT;
  const wonA = Number(match.WonSetHome ?? 0);
  const wonB = Number(match.WonSetGuest ?? 0);
  const decided =
    wonA >= setsToWin ||
    wonB >= setsToWin ||
    match.HomeDisqualification === true ||
    match.GuestDisqualification === true;

  const kickoff = match.MatchDateTime ? Date.parse(match.MatchDateTime) : NaN;
  const started =
    widget?.in_set === true ||
    (widget?.current_set ?? 0) > 0 ||
    wonA + wonB > 0 ||
    (Number.isFinite(kickoff) && kickoff <= now);
  const status: VisBoardData["status"] = decided
    ? "FINISHED"
    : started
      ? "LIVE"
      : "UPCOMING";

  const pointsHome = pointsBySide(stats, true);
  const pointsGuest = pointsBySide(stats, false);

  const playersA = sixOnCourt(
    widget?.lineup_home ?? null,
    widget?.libero_replacing_home ?? null,
    widget?.libero_number_home ?? null,
    input.rosterHome,
    pointsHome,
  );
  const playersB = sixOnCourt(
    widget?.lineup_guest ?? null,
    widget?.libero_replacing_guest ?? null,
    widget?.libero_number_guest ?? null,
    input.rosterGuest,
    pointsGuest,
  );

  const sets = setLadder(match, decided);
  const finished = sets.filter((s) => s.winner !== null);
  // Between sets: a set has been credited and the next has not begun. The feed
  // says so directly — no Duration heuristic, which is the trap spec/37 fell
  // into on the VIS side.
  const inSetBreak = status === "LIVE" && widget?.in_set === false && wonA + wonB > 0;

  const serving: "A" | "B" | null =
    status !== "LIVE" || !widget?.serve
      ? null
      : widget.serve === "home"
        ? "A"
        : "B";

  const teamAAtLeft =
    widget?.left_side === "home" ? true : widget?.left_side === "away" ? false : null;

  const hasStats = (stats?.length ?? 0) > 0;

  return {
    matchNo,
    status,
    teamA: interruptions(match, config, 0, {
      code: "",
      name: match.HomeTeam ?? "",
      players: playersA,
    }),
    teamB: interruptions(match, config, 1, {
      code: "",
      name: match.GuestTeam ?? "",
      players: playersB,
    }),
    setsWonA: wonA,
    setsWonB: wonB,
    scoreA: status === "UPCOMING" ? 0 : Number(widget?.current_set_points_home ?? 0),
    scoreB: status === "UPCOMING" ? 0 : Number(widget?.current_set_points_away ?? 0),
    currentSet: status === "UPCOMING" ? null : (widget?.current_set ?? sets.length ?? 1),
    serving,
    sets,
    teamAAtLeft,
    inSetBreak,
    lastFinishedSet: finished[finished.length - 1] ?? null,
    stats: hasStats
      ? {
          attacksA: sumBySide(stats, true, "SpikeWin"),
          attacksB: sumBySide(stats, false, "SpikeWin"),
          blocksA: sumBySide(stats, true, "BlockWin"),
          blocksB: sumBySide(stats, false, "BlockWin"),
          servesA: sumBySide(stats, true, "ServeWin"),
          servesB: sumBySide(stats, false, "ServeWin"),
          // VolleyStation exposes no opponent-error aggregate on this sheet;
          // showing a fabricated bar would be worse than showing none.
          opponentErrorsA: 0,
          opponentErrorsB: 0,
        }
      : null,
    poolName: input.poolName ?? null,
    tournamentName: input.tournamentName ?? null,
    scheduledLocal: input.scheduledLocal ?? null,
    // No advisory delay in this API; the cadence uses this only as a non-live
    // floor, and 5 s keeps a finished board from polling needlessly.
    pollDelaySeconds: 5,
  };
}
