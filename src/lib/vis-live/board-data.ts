/**
 * VIS payloads → the board's view model (spec/34). Pure functions over raw XML
 * strings: no I/O, no clock reads except the `now` a caller passes in, so the
 * fixtures in src/__tests__/fixtures/vis pin every rule below.
 */

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

export interface VisBoardTeam {
  code: string;
  name: string;
  players: VisBoardPlayer[];
  /** Team time-outs taken in the current set (FIVB 15.1: max 2). */
  timeouts: number;
  /** Substitutions made in the current set (max 6). */
  substitutions: number;
  /** Video challenges requested in the current set. */
  challenges: number;
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
   * The latest set is over but the match is not (VIS stamps `Set@Duration`
   * when a set completes). This is what flips the venue screen to the
   * set-break statistics and back (spec/34 set-rotation).
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
  status: VisMatchStatus;
  resultText: string | null;
  setsText: string | null;
  hall: string | null;
}

const MATCH_ALIASES = ["VolleyballMatch", "VolleyMatch", "Match"] as const;

/** "11:00:00" → "11:00"; leaves anything unexpected alone. */
function hhmm(time: string | null): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : time;
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

/** Status for a MATCH-LIST row, which has no live timestamps to read. */
function summaryStatus(attrs: Attrs): VisMatchStatus {
  if (str(attrs, "MatchResultText")) return "FINISHED";
  // "1" is the confirmed scheduled code; anything else on a result-less row is
  // treated as in progress, so a live match is never hidden from the index.
  return str(attrs, "Status") === "1" ? "UPCOMING" : "LIVE";
}

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
 * NOTE (honest limitation): VIS carries one LineUp per team per set at this
 * Options level, so the list reflects the set's registered rotation. Rotation
 * and mid-set substitutions inside the set are not tracked here — that needs
 * the rally-by-rally feed, an order of magnitude more payload for information a
 * scoreboard does not show.
 */
function lineupPlayers(
  lineup: Attrs | null,
  roster: Map<number, { jersey: number | null; name: string }>,
  points: Map<number, number>,
): VisBoardPlayer[] {
  if (!lineup) return [];
  const liberos = new Set(
    Object.entries(lineup)
      .filter(([k]) => k.startsWith("NoLibero"))
      .map(([, v]) => Number(v))
      .filter((n) => Number.isFinite(n)),
  );
  const players: VisBoardPlayer[] = [];
  for (let pos = 1; pos <= 6; pos++) {
    const no = num(lineup, `NoPlayer${pos}`, -1);
    if (no < 0) continue;
    const bio = roster.get(no);
    players.push({
      position: pos,
      jersey: bio?.jersey ?? null,
      name: bio?.name ?? `#${no}`,
      points: points.get(no) ?? 0,
      isLibero: liberos.has(no),
    });
  }
  return players;
}

/** `GetVolleyLive` (Options=BOARD_OPTIONS) → the board's view model. */
export function mapVolleyLive(
  xml: string,
  matchNo: number,
  now: number = Date.now(),
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

  // A set is OVER when VIS has stamped its Duration — the feed's explicit
  // signal, deliberately preferred over a 25-plus-2 score heuristic: a set the
  // scorer is still correcting must not be declared done by us.
  const latestEnded =
    !!latest && num(latest.attrs, "Duration") > 0 &&
    num(latest.attrs, "PointsTeamA") + num(latest.attrs, "PointsTeamB") > 0;

  const sets: VisBoardSet[] = setBlocks.map((s, i) => {
    const scoreA = num(s.attrs, "PointsTeamA");
    const scoreB = num(s.attrs, "PointsTeamB");
    const isLatest = i === setBlocks.length - 1;
    // The set in PLAY has no winner even at 25-23 (VIS may still correct it);
    // a set with its Duration stamped is over and does.
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

  const matchRow = firstAliasAttrs(matchBlock?.inner ?? "", ...MATCH_ALIASES);

  return {
    matchNo,
    status,
    teamA: {
      code: str(blockA?.attrs, "Code") ?? "",
      name: str(blockA?.attrs, "Name") ?? "",
      players: lineupPlayers(lineupA, rosterA, points),
      timeouts: num(latest?.attrs, "NbTimeoutTeamA"),
      substitutions: num(latest?.attrs, "NbSubstitutionTeamA"),
      challenges: num(latest?.attrs, "NbChallengeRequestedTeamA"),
    },
    teamB: {
      code: str(blockB?.attrs, "Code") ?? "",
      name: str(blockB?.attrs, "Name") ?? "",
      players: lineupPlayers(lineupB, rosterB, points),
      timeouts: num(latest?.attrs, "NbTimeoutTeamB"),
      substitutions: num(latest?.attrs, "NbSubstitutionTeamB"),
      challenges: num(latest?.attrs, "NbChallengeRequestedTeamB"),
    },
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
  const emptyTeam = (code: string | null, name: string | null): VisBoardTeam => ({
    code: code ?? "",
    name: name ?? "",
    players: [],
    timeouts: 0,
    substitutions: 0,
    challenges: 0,
  });
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
      status: summaryStatus(a),
      resultText: str(a, "MatchResultText"),
      setsText: str(a, "SetsResultsText"),
      hall: str(a, "Hall"),
    }));
}
