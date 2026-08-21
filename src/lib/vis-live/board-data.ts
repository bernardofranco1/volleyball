/**
 * VIS payloads → the board's view model (spec/34). Pure functions over raw XML
 * strings: no I/O, no clock reads except the `now` a caller passes in, so the
 * fixtures in src/__tests__/fixtures/vis pin every rule below.
 */

import { rotationsBefore, ralliesOf, type Side } from "./rotation";
import {
  type Attrs,
  allAliasAttrs,
  allTagAttrs,
  firstAliasAttrs,
  firstTagAttrs,
  num,
  str,
  tagBlocks,
} from "./parse";

export type VisMatchStatus = "UPCOMING" | "LIVE" | "FINISHED";

/** One of the six on court, as the board lists them. */
export interface VisBoardPlayer {
  /** Court position 1-6 (1 = the serving position). */
  position: number;
  jersey: number | null;
  name: string;
  points: number;
  isLibero: boolean;
}

/**
 * The three interruption allowances a team gets per set in official FIVB indoor
 * competition — the same numbers `src/engine/config.ts` gives our own INDOOR
 * ruleset, and unchanged in the deciding set. The boards COUNT DOWN from these.
 */
export const FIVB_PER_SET = { timeouts: 2, substitutions: 6, challenges: 2 } as const;

export interface VisBoardTeam {
  code: string;
  name: string;
  players: VisBoardPlayer[];
  /** Team time-outs TAKEN in the current set (FIVB 15.1: max 2). */
  timeoutsTaken: number;
  /** Substitutions MADE in the current set (max 6). */
  substitutionsUsed: number;
  /**
   * Video challenges REFUSED in the current set — not the number requested.
   * A team that wins its challenge keeps the right, so `NbChallengeRefused*`
   * is the one that costs an allowance and the only one the countdown may use.
   */
  challengesRefused: number;
  /** Challenges requested, refused or not. Not displayed; kept for the log. */
  challengesRequested: number;
  /** What is LEFT this set — what every board actually shows. */
  timeoutsRemaining: number;
  substitutionsRemaining: number;
  challengesRemaining: number;
}

export interface VisBoardSet {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | null;
}

/** Match-total team statistics — the set-break screen's four bars. */
export interface VisTeamTotals {
  attacksA: number;
  attacksB: number;
  blocksA: number;
  blocksB: number;
  servesA: number;
  servesB: number;
  opponentErrorsA: number;
  opponentErrorsB: number;
}

export interface VisBoardData {
  matchNo: number;
  status: VisMatchStatus;
  teamA: VisBoardTeam;
  teamB: VisBoardTeam;
  /** Sets won — the small boxes under the live score. */
  setsWonA: number;
  setsWonB: number;
  /** Current-set points — the big boxes. */
  scoreA: number;
  scoreB: number;
  currentSet: number | null;
  /** Which side serves, or null when not live / unknown. */
  serving: "A" | "B" | null;
  /** Completed + in-progress sets, for the ladder. */
  sets: VisBoardSet[];
  /**
   * Which team stands on the LEFT of the court (`Set@NoTeamAtLeft`), or null
   * when unknown. The U-shape board frames the actual TV picture, so its rails
   * follow the physical sides, not A/B.
   */
  teamAAtLeft: boolean | null;
  /**
   * The latest set is over but the match is not — i.e. the match has already
   * been credited with that set (`Match@MatchPointsA/B`). This is what flips
   * the venue screen to the set-break statistics and back (spec/34
   * set-rotation). NOT derived from `Set@Duration`: the feed stamps that while
   * a set is being played, which used to strand every live board on the
   * statistics screen (spec/37 fix).
   */
  inSetBreak: boolean;
  /** The set whose result the break screen headlines, or null before any. */
  lastFinishedSet: VisBoardSet | null;
  /** Match-total team statistics, or null when the feed carries none. */
  stats: VisTeamTotals | null;
  poolName: string | null;
  tournamentName: string | null;
  /** Venue-local kick-off as VIS states it ("2026-08-19 11:00"); no offset. */
  scheduledLocal: string | null;
  pollDelaySeconds: number;
}

export interface VisMatchSummary {
  matchNo: number;
  numberInTournament: number | null;
  teamAName: string;
  teamBName: string;
  teamACode: string | null;
  teamBCode: string | null;
  dateLocal: string | null;
  timeLocal: string | null;
  /**
   * Venue-local kick-off with NO offset, exactly as VIS states it
   * ("2026-08-21T10:00:00"), and the same instant in UTC
   * ("2026-08-21T02:00:00Z"). Both halves are needed: the pair IS the venue's
   * UTC offset for that fixture, so the index can show a match in any zone
   * without a tz database and without guessing at DST. Per MATCH, not per
   * competition — tournament 1736 spans ten cities and eight offsets.
   */
  scheduledVenue: string | null;
  scheduledUtc: string | null;
  status: VisMatchStatus;
  resultText: string | null;
  setsText: string | null;
  hall: string | null;
  /** The venue's city as VIS states it — the label for "event location time". */
  city: string | null;
}

const MATCH_ALIASES = ["VolleyballMatch", "VolleyMatch", "Match"] as const;

/** "11:00:00" → "11:00"; leaves anything unexpected alone. */
function hhmm(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : time;
}

/**
 * `DateTimeLocal` when VIS sends it, else the date+time pair stitched into the
 * same shape. Older captures — and any request whose `Fields` predate spec/46 —
 * carry only the pair, and a row with no venue time at all is possible too.
 */
function venueIsoLocal(a: Attrs): string | null {
  const combined = str(a, "DateTimeLocal");
  if (combined) return combined;
  const date = str(a, "DateLocal");
  if (!date) return null;
  const time = str(a, "TimeLocal");
  return `${date}T${time ?? "00:00:00"}`;
}

function scheduledLocal(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const t = hhmm(time);
  return t ? `${date} ${t}` : date;
}

/**
 * Status from the timestamps, not the numeric enum.
 *
 * `Match@Status` is confirmed only for 1 (scheduled) and 25 (finished);
 * the value a running match carries is unverified, and guessing it would put a
 * wrong state on a TV. The timestamps are unambiguous: an end time means the
 * match is over, a start time in the past means it is under way.
 */
export function inferStatus(
  match: Attrs | null,
  now: number,
  scheduledUtcMs?: number | null,
): VisMatchStatus {
  if (str(match, "EndDateTime")) return "FINISHED";
  const begin = str(match, "BeginDateTime");
  if (begin) {
    const t = Date.parse(begin);
    if (Number.isFinite(t) && t <= now) return "LIVE";
    if (Number.isFinite(t)) return "UPCOMING";
    return "LIVE";
  }
  if (scheduledUtcMs != null && scheduledUtcMs <= now) return "LIVE";
  return "UPCOMING";
}

/**
 * Status for a MATCH-LIST row, which carries no live timestamps to read.
 *
 * The rule used to be "has MatchResultText ⇒ finished, else Status 1 ⇒
 * scheduled, else live". Both halves were wrong, and the index showed scheduled
 * matches as LIVE and live ones as FINISHED. Measured against tournaments 1670
 * and 1671 on 2026-08-19:
 *
 *   Status  rows  SetsResultsText / MatchResultText   reality
 *   1        41   absent                              scheduled
 *   2         2   absent                              scheduled
 *   5         2   "(12-8)" / "0-0"                    IN PLAY
 *   25      105   "(20-25, 24-26, 19-25)" / "0-3"     finished
 *
 * So a live row DOES carry a MatchResultText — the running sets tally, "0-0" —
 * and a scheduled row can be Status 2 as easily as 1.
 *
 * The rule below leans on the data rather than on the enum wherever it can, so
 * an unseen status code cannot break it:
 *   - nothing played AND a known pre-match code ⇒ UPCOMING;
 *   - nothing played on any OTHER code ⇒ LIVE, because a match that has just
 *     started may not have a set score for a rally or two, and hiding a live
 *     match from the index is the worse error of the two;
 *   - a decided tally, or the terminal status ⇒ FINISHED;
 *   - anything else that has started ⇒ LIVE.
 */
function summaryStatus(attrs: Attrs): VisMatchStatus {
  const sets = str(attrs, "SetsResultsText");
  const result = str(attrs, "MatchResultText");
  // Nothing has been played: VIS writes neither field before the first whistle.
  if (!sets && !result) {
    return VIS_STATUS_SCHEDULED.has(num(attrs, "Status", -1)) ? "UPCOMING" : "LIVE";
  }
  // The one status code observed on a completed match. Kept as a signal rather
  // than the sole test, because a forfeit or a retirement need not reach the
  // winning number of sets.
  if (num(attrs, "Status", -1) === VIS_STATUS_FINISHED) return "FINISHED";
  // A side has won the match outright (FIVB indoor: best of five).
  const won = Math.max(num(attrs, "MatchPointsA"), num(attrs, "MatchPointsB"));
  if (won >= SETS_TO_WIN_MATCH) return "FINISHED";
  return "LIVE";
}

/** The list-row status VIS stamps on a completed match (measured, see above). */
const VIS_STATUS_FINISHED = 25;
/** List-row statuses observed on matches that have not started (measured). */
const VIS_STATUS_SCHEDULED = new Set([1, 2]);
/** FIVB indoor is best of five. */
const SETS_TO_WIN_MATCH = 3;

/**
 * Roster rows scoped to their team: VIS nests `Player`(No, NoShirt) inside
 * `Team`, with the names on the `VolleyballPlayer` child. Returns jersey + a
 * display name per player number.
 */
function rosterOf(teamInner: string): Map<number, { jersey: number | null; name: string }> {
  const out = new Map<number, { jersey: number | null; name: string }>();
  for (const block of tagBlocks(teamInner, "Player")) {
    const no = num(block.attrs, "No", -1);
    if (no < 0) continue;
    const bio = firstTagAttrs(block.inner, "VolleyballPlayer");
    // TeamNamePlayer is the shirt name (what a board shows); fall back to the
    // family name, then to the number so a row is never blank.
    const name =
      str(bio, "TeamNamePlayer") ??
      str(bio, "LastNamePlayer") ??
      `#${num(block.attrs, "NoShirt", no)}`;
    out.set(no, {
      jersey: str(block.attrs, "NoShirt") ? num(block.attrs, "NoShirt") : null,
      name,
    });
  }
  return out;
}

/** Player point totals, keyed by player number (`PlayerStatistics@TotalPoints`). */
function pointsByPlayer(xml: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const st of allTagAttrs(xml, "PlayerStatistics")) {
    const no = num(st, "NoPlayer", -1);
    if (no < 0) continue;
    // Match-total rows (Options 2048) are one per player; keep the largest in
    // case a payload ever carries per-set rows too (Options 256).
    out.set(no, Math.max(out.get(no) ?? 0, num(st, "TotalPoints")));
  }
  return out;
}

/**
 * The six on court for one team, from the set's `LineUp`
 * (`NoPlayer1…NoPlayer6` = court positions 1-6, `NoLibero*` marks liberos).
 *
 * The caller passes the LAST LineUp of the current set, not the first: spec/35
 * turned on Options bit 512 for the per-rally lineup stream, so these six are
 * the rotation of the newest rally, with position 1 — the server — at index 0.
 * `rotated` advances it one place when the serve has just changed hands and the
 * feed has not published the new rotation yet; see sideOutRotation.
 */
function lineupPlayers(
  lineup: Attrs | null,
  roster: Map<number, { jersey: number | null; name: string }>,
  points: Map<number, number>,
  liberos: Set<number>,
  rotated: boolean,
): VisBoardPlayer[] {
  if (!lineup) return [];
  const order: number[] = [];
  for (let pos = 1; pos <= 6; pos++) {
    const no = num(lineup, `NoPlayer${pos}`, -1);
    if (no >= 0) order.push(no);
  }
  // One clockwise rotation = a left shift: position 1 goes to 6 and everyone
  // else moves up one. Verified against consecutive rally lineups in the feed.
  const seq =
    rotated && order.length === 6 ? [...order.slice(1), order[0]] : order;
  return playersFrom(seq, roster, points, liberos);
}

/** An ordered six (position 1 first) dressed with roster names and points. */
function playersFrom(
  order: number[],
  roster: Map<number, { jersey: number | null; name: string }>,
  points: Map<number, number>,
  liberos: Set<number>,
): VisBoardPlayer[] {
  return order.map((no, i) => {
    const bio = roster.get(no);
    return {
      position: i + 1,
      jersey: bio?.jersey ?? null,
      name: bio?.name ?? `#${no}`,
      points: points.get(no) ?? 0,
      isLibero: liberos.has(no),
    };
  });
}

/**
 * The six each side is standing in, when the caller has worked it out from the
 * rules rather than reading it off the feed (spec/43). Roster numbers as
 * strings, position 1 first; a null side means "no answer, use the feed".
 */
export interface LineupOverride {
  A: string[] | null;
  B: string[] | null;
}

/**
 * Which side has rotated since the newest lineup the feed published, if any.
 *
 * VIS attaches a `LineUp` to each `Rally`, and it is the rotation used DURING
 * that rally — published only once the rally has finished. So the newest
 * lineup available is always the previous rally's. That is right while a team
 * serves on, and wrong the moment the serve changes hands: the side winning a
 * side-out rotates BEFORE it serves, so the board showed the outgoing rotation
 * and highlighted the wrong server, on roughly every second rally.
 *
 * The missing step is derivable from the running score each rally stamps. The
 * winner of rally N serves rally N+1, so the serve changed hands on the last
 * rally exactly when its winner differs from the previous rally's — and that
 * winner, now on serve, has rotated once.
 *
 * Returns null when it cannot be known: fewer than two rallies, or a rally that
 * moved neither score. Not rotating is the safe answer — it is the feed's own
 * last word rather than a guess on top of it.
 */
function sideOutRotation(
  setInner: string,
  firstServer: Side | null,
): "A" | "B" | null {
  const rallies = ralliesOf(setInner);
  if (rallies.length === 0) return null;

  // With the set's first server known, the rules answer this outright, at any
  // rally count — including the first, where there is no previous rally to name
  // the server from and the board used to show the outgoing rotation for a
  // whole rally whenever the receiving side won the opening point.
  if (firstServer) {
    const during = rotationsBefore(rallies, firstServer, rallies.length);
    const now = rotationsBefore(rallies, firstServer, rallies.length + 1);
    if (now.A > during.A) return "A";
    if (now.B > during.B) return "B";
    return null;
  }

  // Without it, the serve changed hands on the last rally exactly when its
  // winner differs from the previous rally's — which needs two rallies.
  if (rallies.length < 2) return null;
  const last = rallies[rallies.length - 1].winner;
  const before = rallies[rallies.length - 2].winner;
  if (!last || !before || last === before) return null;
  return last;
}

/** `GetVolleyLive` (Options=BOARD_OPTIONS) → the board's view model. */
export function mapVolleyLive(
  xml: string,
  matchNo: number,
  now: number = Date.now(),
  /**
   * Who served the set's first rally, when the caller knows (spec/42). Only
   * observable in the moment before a set has any rallies, so the store
   * remembers it; without it the first rally of a set cannot be judged a
   * side-out and the rotation waits one rally to catch up.
   */
  firstServer: Side | null = null,
  /**
   * The enforced rotation (spec/43). When a side is present it REPLACES the
   * order and membership the feed published for that side — the feed's own
   * lineup is stale or wrong often enough to matter, and the rules plus the
   * recorded serve actions are the better authority. A null side keeps the
   * pre-spec/43 behaviour for that side, side-out rotation included.
   */
  lineupOverride: LineupOverride | null = null,
): VisBoardData {
  const root = firstTagAttrs(xml, "VolleyLive");
  const matchBlock = tagBlocks(xml, "Match")[0] ?? null;
  const match = matchBlock?.attrs ?? null;
  const status = inferStatus(match, now);

  const noTeamA = num(match, "NoTeamA", -1);
  const noTeamB = num(match, "NoTeamB", -2);

  // Teams: trust the numbers, fall back to document order (A then B).
  const teamBlocks = tagBlocks(xml, "Team");
  const blockA =
    teamBlocks.find((t) => num(t.attrs, "No", -99) === noTeamA) ?? teamBlocks[0];
  const blockB =
    teamBlocks.find((t) => num(t.attrs, "No", -99) === noTeamB) ?? teamBlocks[1];

  const points = pointsByPlayer(xml);
  const rosterA = blockA ? rosterOf(blockA.inner) : new Map();
  const rosterB = blockB ? rosterOf(blockB.inner) : new Map();

  // Sets in order; the last one is the current set while play is on.
  const setBlocks = tagBlocks(xml, "Set").sort(
    (a, b) => num(a.attrs, "No") - num(b.attrs, "No"),
  );
  const latest = setBlocks[setBlocks.length - 1] ?? null;

  // A set is OVER when the match has been CREDITED with it.
  //
  // This used to read `Set@Duration > 0`, on the assumption that VIS stamps a
  // duration when a set completes. It does not: the feed stamps elapsed time
  // while the set is being PLAYED — match 27547 on 2026-08-19 carried
  // Duration="778" at 12-11 in set one — so every live board declared itself in
  // a set break within seconds of the first point and sat on the statistics
  // screen for the whole match.
  //
  // `Match@MatchPointsA/B` is the sets each side has WON, so their sum is the
  // number of sets that are finished. If the latest set's own number is greater
  // than that, it has not been credited to anybody and is still in play. The
  // rule is arithmetic on two figures the feed maintains for the result itself,
  // it needs no score heuristic, and it degrades the safe way: unknown figures
  // read as zero, which shows the live scoreboard rather than a false break.
  const setsCompleted = num(match, "MatchPointsA") + num(match, "MatchPointsB");
  const latestEnded = !!latest && num(latest.attrs, "No", 0) <= setsCompleted;

  const sets: VisBoardSet[] = setBlocks.map((s, i) => {
    const scoreA = num(s.attrs, "PointsTeamA");
    const scoreB = num(s.attrs, "PointsTeamB");
    const isLatest = i === setBlocks.length - 1;
    // The set in PLAY has no winner even at 25-23 (VIS may still correct it);
    // a set the match has been credited with is over and does.
    const decided = !isLatest || status === "FINISHED" || latestEnded;
    const winner: "A" | "B" | null =
      decided && scoreA !== scoreB ? (scoreA > scoreB ? "A" : "B") : null;
    return { setNumber: num(s.attrs, "No", i + 1), scoreA, scoreB, winner };
  });

  const finishedSets = sets.filter((x) => x.winner !== null);
  const inSetBreak = status === "LIVE" && latestEnded;

  const atLeft = num(latest?.attrs, "NoTeamAtLeft", -99);
  const teamAAtLeft =
    atLeft === noTeamA ? true : atLeft === noTeamB ? false : null;

  // Team totals. At the board's Options level VIS keeps TeamStatistics thin
  // (OpponentErrors/TeamFaults only) — the skill aggregates live on the PLAYER
  // match-total rows, whose per-team sums equal the full payload's team rows
  // exactly (verified against the 65535 reference, 2026-08-18). "Attacks" on
  // the venue screen is total attack points, i.e. spike + back-row spike.
  const teamStats = allTagAttrs(matchBlock?.inner ?? "", "TeamStatistics");
  const statsRowA = teamStats.find((t) => num(t, "NoTeam", -99) === noTeamA) ?? null;
  const statsRowB = teamStats.find((t) => num(t, "NoTeam", -99) === noTeamB) ?? null;
  const playerRows = allTagAttrs(matchBlock?.inner ?? "", "PlayerStatistics");
  const sumFor = (roster: Map<number, unknown>, key: string): number =>
    playerRows.reduce(
      (sum, r) => (roster.has(num(r, "NoPlayer", -1)) ? sum + num(r, key) : sum),
      0,
    );
  const stats: VisTeamTotals | null =
    playerRows.length > 0 || statsRowA || statsRowB
      ? {
          attacksA: sumFor(rosterA, "SpikePoint") + sumFor(rosterA, "BackSpikePoint"),
          attacksB: sumFor(rosterB, "SpikePoint") + sumFor(rosterB, "BackSpikePoint"),
          blocksA: sumFor(rosterA, "BlockPoint"),
          blocksB: sumFor(rosterB, "BlockPoint"),
          servesA: sumFor(rosterA, "ServePoint"),
          servesB: sumFor(rosterB, "ServePoint"),
          opponentErrorsA: num(statsRowA, "OpponentErrors"),
          opponentErrorsB: num(statsRowB, "OpponentErrors"),
        }
      : null;

  const servingNo = num(latest?.attrs, "NoServingTeam", -99);
  const serving: "A" | "B" | null =
    status !== "LIVE"
      ? null
      : servingNo === noTeamA
        ? "A"
        : servingNo === noTeamB
          ? "B"
          : null;

  // LineUps are nested in the current set, in CHRONOLOGICAL order — one per
  // rally once the events stream is requested (Options bit 512). The LAST one
  // for a team is therefore the rotation on court right now, reflecting every
  // rotation, substitution and libero replacement since the set began
  // (spec/35 W3). A payload carrying only the registered starting six has
  // exactly one per team, and this picks the same row it always did.
  const lineups = latest ? allTagAttrs(latest.inner, "LineUp") : [];
  const lastFor = (noTeam: number): Attrs | null => {
    const own = lineups.filter((l) => num(l, "NoTeam", -99) === noTeam);
    return own.length > 0 ? own[own.length - 1] : null;
  };
  const lineupA = lastFor(noTeamA);
  const lineupB = lastFor(noTeamB);
  // Every registered libero of the set, from whichever lineups name them: the
  // per-rally lineups carry no `NoLibero*`, so reading only the newest one
  // would leave the libero on court unmarked.
  const liberosFor = (noTeam: number): Set<number> => {
    const out = new Set<number>();
    for (const l of lineups) {
      if (num(l, "NoTeam", -99) !== noTeam) continue;
      for (const [k, v] of Object.entries(l)) {
        if (!k.startsWith("NoLibero")) continue;
        const no = Number(v);
        if (Number.isFinite(no)) out.add(no);
      }
    }
    return out;
  };
  const rotating = sideOutRotation(latest?.inner ?? "", firstServer);

  /**
   * The six for one side: the enforced rotation when there is one, otherwise
   * the feed's newest lineup with the side-out step applied. An enforced six is
   * already the rotation for the rally in progress, so `rotating` must NOT be
   * applied on top of it — that would advance it a second time.
   */
  const sixFor = (
    side: "A" | "B",
    lineup: Attrs | null,
    noTeam: number,
    roster: Map<number, { jersey: number | null; name: string }>,
  ): VisBoardPlayer[] => {
    const liberos = liberosFor(noTeam);
    const enforced = lineupOverride?.[side];
    if (enforced && enforced.length > 0) {
      return playersFrom(
        enforced.map((no) => Number(no)).filter((no) => Number.isFinite(no)),
        roster,
        points,
        liberos,
      );
    }
    return lineupPlayers(lineup, roster, points, liberos, rotating === side);
  };

  const matchRow = firstAliasAttrs(matchBlock?.inner ?? "", ...MATCH_ALIASES);

  return {
    matchNo,
    status,
    teamA: interruptions(latest?.attrs, "A", {
      code: str(blockA?.attrs, "Code") ?? "",
      name: str(blockA?.attrs, "Name") ?? "",
      players: sixFor("A", lineupA, noTeamA, rosterA),
    }),
    teamB: interruptions(latest?.attrs, "B", {
      code: str(blockB?.attrs, "Code") ?? "",
      name: str(blockB?.attrs, "Name") ?? "",
      players: sixFor("B", lineupB, noTeamB, rosterB),
    }),
    setsWonA: num(match, "MatchPointsA"),
    setsWonB: num(match, "MatchPointsB"),
    scoreA: status === "UPCOMING" ? 0 : num(latest?.attrs, "PointsTeamA"),
    scoreB: status === "UPCOMING" ? 0 : num(latest?.attrs, "PointsTeamB"),
    currentSet: status === "UPCOMING" ? null : num(latest?.attrs, "No", 1),
    serving,
    sets,
    teamAAtLeft,
    inSetBreak,
    lastFinishedSet: finishedSets[finishedSets.length - 1] ?? null,
    stats,
    poolName: str(firstTagAttrs(xml, "Pool"), "Name"),
    tournamentName: str(firstTagAttrs(xml, "Tournament"), "Name"),
    scheduledLocal: scheduledLocal(
      str(matchRow, "DateLocal"),
      str(matchRow, "TimeLocal"),
    ),
    pollDelaySeconds: Math.max(5, num(root, "PollDelay", 20)),
  };
}

/**
 * The current set's interruption state for one side, counted DOWN.
 *
 * VIS reports what has been USED, and omits an attribute entirely when the
 * count is zero, so every read defaults to 0. Two of the three are then simple
 * subtraction; substitutions are not, because VIS publishes
 * `NbRemainingSubstitutionTeam*` itself and that figure is authoritative — a
 * team can be left with fewer than 6 minus its substitutions once an
 * exceptional substitution is involved, and events run under other substitution
 * rules do exist in the feed — a captured AVC set reports 4 used with 4 still
 * remaining. So the feed's figure is taken VERBATIM and never clamped to 6;
 * the FIVB allowance is only the fallback when the attribute is absent.
 */
function interruptions(
  set: Attrs | null | undefined,
  side: "A" | "B",
  base: Pick<VisBoardTeam, "code" | "name" | "players">,
): VisBoardTeam {
  const taken = num(set, `NbTimeoutTeam${side}`);
  const used = num(set, `NbSubstitutionTeam${side}`);
  const refused = num(set, `NbChallengeRefusedTeam${side}`);
  const requested = num(set, `NbChallengeRequestedTeam${side}`);
  const remainingSubs = set?.[`NbRemainingSubstitutionTeam${side}`] != null
    ? num(set, `NbRemainingSubstitutionTeam${side}`)
    : FIVB_PER_SET.substitutions - used;
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  return {
    ...base,
    timeoutsTaken: taken,
    substitutionsUsed: used,
    challengesRefused: refused,
    challengesRequested: requested,
    timeoutsRemaining: clamp(FIVB_PER_SET.timeouts - taken, FIVB_PER_SET.timeouts),
    substitutionsRemaining: Math.max(0, remainingSubs),
    challengesRemaining: clamp(FIVB_PER_SET.challenges - refused, FIVB_PER_SET.challenges),
  };
}

/**
 * `GetVolleyMatch` → an UPCOMING board. The pre-start fallback: a match with no
 * live row yet has no `VolleyLive` payload at all, but the TV still wants the
 * teams, the kick-off time, and a 0-0 frame.
 */
export function mapVolleyMatch(
  xml: string,
  matchNo: number,
  now: number = Date.now(),
): VisBoardData | null {
  const attrs = firstAliasAttrs(xml, ...MATCH_ALIASES);
  if (!attrs) return null;
  // Nothing has been used before the first whistle, so every allowance is full.
  const emptyTeam = (code: string | null, name: string | null): VisBoardTeam =>
    interruptions(null, "A", { code: code ?? "", name: name ?? "", players: [] });
  return {
    matchNo,
    status: inferStatus(attrs, now),
    teamA: emptyTeam(str(attrs, "TeamACode"), str(attrs, "TeamAName")),
    teamB: emptyTeam(str(attrs, "TeamBCode"), str(attrs, "TeamBName")),
    setsWonA: num(attrs, "MatchPointsA"),
    setsWonB: num(attrs, "MatchPointsB"),
    scoreA: 0,
    scoreB: 0,
    currentSet: null,
    serving: null,
    sets: [],
    teamAAtLeft: null,
    inSetBreak: false,
    lastFinishedSet: null,
    stats: null,
    poolName: null,
    tournamentName: null,
    scheduledLocal: scheduledLocal(str(attrs, "DateLocal"), str(attrs, "TimeLocal")),
    pollDelaySeconds: 20,
  };
}

/** `GetVolleyMatchList` → day-index rows (also the board allowlist). */
export function mapVolleyMatchList(xml: string): VisMatchSummary[] {
  return allAliasAttrs(xml, ...MATCH_ALIASES)
    .filter((a) => str(a, "No"))
    .map((a) => ({
      matchNo: num(a, "No"),
      numberInTournament: str(a, "NoInTournament") ? num(a, "NoInTournament") : null,
      teamAName: str(a, "TeamAName") ?? str(a, "TeamACode") ?? "—",
      teamBName: str(a, "TeamBName") ?? str(a, "TeamBCode") ?? "—",
      teamACode: str(a, "TeamACode"),
      teamBCode: str(a, "TeamBCode"),
      dateLocal: str(a, "DateLocal"),
      timeLocal: hhmm(str(a, "TimeLocal")),
      scheduledVenue: venueIsoLocal(a),
      scheduledUtc: str(a, "DateTimeUtc"),
      status: summaryStatus(a),
      resultText: str(a, "MatchResultText"),
      setsText: str(a, "SetsResultsText"),
      hall: str(a, "Hall"),
      city: str(a, "City"),
    }));
}
