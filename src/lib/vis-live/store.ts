/**
 * Server-side cache in front of VIS (spec/34).
 *
 * Three jobs:
 *  - **Bound upstream traffic.** Any number of TVs polling a board costs VIS one
 *    request per `PollDelay`, because every viewer is answered from here.
 *  - **Survive a flaky upstream.** On failure the last good payload is served
 *    with its age, so a board shows a slightly stale score instead of an error.
 *    A TV that goes blank in a full arena is the worst outcome available.
 *  - **Keep the endpoint closed.** Only match numbers that belong to a
 *    VIS-linked competition of this platform are servable; without that the
 *    board route would be an open relay onto VIS for arbitrary numbers.
 *
 * Caches are module-level, so they live per serverless instance. That is the
 * right granularity: each instance independently honours PollDelay, and a cold
 * start costs one upstream call.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import {
  isNoChanges,
  payloadVersion,
  visRequest,
  volleyLiveEnvelope,
  volleyMatchEnvelope,
  volleyMatchListEnvelope,
} from "./client";
import {
  type VisBoardData,
  type VisMatchSummary,
  mapVolleyLive,
  mapVolleyMatch,
  mapVolleyMatchList,
} from "./board-data";
import { MOCK_MATCH_NO, mockLiveXml } from "./mock";
import { REPLAY_MATCH_NO, replayXml } from "./replay";
import { pollIntervalMs, VS_IN_RALLY_MS } from "./cadence";
import { allTagAttrs, tagBlocks, num, type Attrs } from "./parse";
import {
  auditSet,
  enforcementRows,
  firstServerFor,
  noteFirstServer,
  recordRotationAudit,
} from "./rotation-audit";
import { stabiliseLineups } from "./lineup-stability";
import { designatedLiberos, parseSetEvents, playerSides } from "./events";
import { enforceLineups, type EnforcedLineups } from "./serve-succession";
import { sixOf } from "./rotation";
import {
  sourceFor,
  rosterOf,
  teamOf,
  type BoardSource,
  type VsTarget,
} from "@/lib/vs-live/resolve";
import { vsMatch, vsStats } from "@/lib/vs-live/client";
import { mapVsBoard } from "@/lib/vs-live/board-data";
import type { VsStatsRow } from "@/lib/vs-live/types";

type VsStatsRowList = VsStatsRow[];

interface Entry<T> {
  value: T;
  /** When it was fetched (ms). */
  at: number;
  /** How long it may be served without a refetch (ms). */
  ttlMs: number;
  /**
   * When the payload last actually CHANGED (ms), as opposed to when it was last
   * re-fetched (spec/41). VIS answering happily while nothing moves is the
   * failure the status page exists to catch — a board frozen at 12-11 because
   * the scorer's laptop stopped publishing looks exactly like a board nobody is
   * watching, and every other check is green throughout.
   */
  changedAt: number;
  /**
   * The feed's own `VolleyLive@Version` for this payload (spec/43). Sent back
   * on the next poll: VIS answers `<NoChanges/>` when nothing has moved, which
   * is most polls of a match that is not in a rally.
   */
  visVersion?: number;
}

const MATCH_LIST_TTL_MS = 60_000;
const UPCOMING_TTL_MS = 60_000;
const ALLOWLIST_TTL_MS = 10 * 60_000;

const matchLists = new Map<number, Entry<VisMatchSummary[]>>();
const boards = new Map<number, Entry<VisBoardData>>();
/**
 * Boards built from VolleyStation, keyed by the same VIS match number as
 * `boards` (spec/45 §6bis). A separate map on purpose: during an event the same
 * match is deliberately served from BOTH feeds, to two different screens.
 */
const vsBoards = new Map<number, Entry<VisBoardData>>();
/** Per-player stats, which change per rally rather than per poll. */
const vsStatsCache = new Map<number, { value: VsStatsRowList; at: number }>();
const VS_STATS_TTL_MS = 12_000;
let allowlist: Entry<Map<number, number>> | null = null; // matchNo → tournamentNo

/** In-flight de-duplication: concurrent viewers share one upstream call. */
const inFlight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function fresh<T>(entry: Entry<T> | undefined | null, now: number): boolean {
  return !!entry && now - entry.at < entry.ttlMs;
}

export interface Aged<T> {
  value: T;
  /** Age of the underlying VIS read, in seconds. */
  ageSeconds: number;
}

function aged<T>(entry: Entry<T>, now: number): Aged<T> {
  return { value: entry.value, ageSeconds: Math.round((now - entry.at) / 1000) };
}

/**
 * What a board looks like to "has anything moved?": the score, the sets, the
 * set number and who serves. Deliberately not the whole payload — VIS restates
 * statistics and timestamps that shift without a rally being played, and a
 * fingerprint that changed on those would report a dead feed as advancing.
 */
function boardPulse(b: VisBoardData): string {
  return [
    b.scoreA, b.scoreB, b.setsWonA, b.setsWonB, b.currentSet, b.serving, b.status,
    b.sets.length,
  ].join("|");
}

/** Every match of a tournament, cached; serves stale on upstream failure. */
export async function getMatchList(
  tournamentNo: number,
  now: number = Date.now(),
): Promise<Aged<VisMatchSummary[]>> {
  const hit = matchLists.get(tournamentNo);
  if (fresh(hit, now)) return aged(hit!, now);

  return dedupe(`list:${tournamentNo}`, async () => {
    try {
      const xml = await visRequest(volleyMatchListEnvelope(tournamentNo));
      const entry: Entry<VisMatchSummary[]> = {
        value: mapVolleyMatchList(xml),
        at: Date.now(),
        ttlMs: MATCH_LIST_TTL_MS,
        changedAt: Date.now(),
      };
      matchLists.set(tournamentNo, entry);
      return aged(entry, Date.now());
    } catch (err) {
      if (hit) return aged(hit, Date.now()); // stale beats nothing
      throw err;
    }
  });
}

/**
 * The board payload for one match. Tries the live feed; falls back to the
 * single-match read for a fixture that has not started (no live row yet).
 *
 * The TTL is the cadence for the state the board is IN (spec/37): one second
 * while a set is being played, backed off otherwise, never below the feed's own
 * `PollDelay` except during play. Concurrent viewers are collapsed by `dedupe`,
 * so the TTL is what actually bounds upstream traffic — one call per interval
 * per match per instance, however many screens are watching.
 */
export async function getBoard(
  matchNo: number,
  now: number = Date.now(),
  /**
   * A per-SCREEN source override (`?source=`), which beats the competition's
   * own setting (spec/45 §6bis). This is what lets one match be watched from
   * both feeds at once, on two TVs, during an event.
   */
  requested?: BoardSource | null,
): Promise<Aged<VisBoardData> & { source: BoardSource; pollMs: number }> {
  // Deliberately not inside the try: a failure to work out the source must not
  // be able to stop a board that VIS could have served.
  const chosen = await sourceFor(matchNo, requested ?? null).catch(() => null);
  if (chosen?.source === "vs" && chosen.target) {
    try {
      const served = await getVsBoard(matchNo, chosen.target, now);
      return { ...served, source: "vs" };
    } catch {
      // Stale VolleyStation never beats live VIS: fall through in the SAME
      // request rather than serving something old or an error.
    }
  }
  return { ...(await getVisBoard(matchNo, now)), source: "vis" };
}

/**
 * The cadence an entry was actually stored with, which is what the browser
 * should poll at. Recomputing it in the route instead would ignore anything the
 * store knew and the mapper did not — the in-rally cadence, for one.
 */
function withPoll(a: Aged<VisBoardData>, entry: Entry<VisBoardData>) {
  return { ...a, pollMs: entry.ttlMs };
}

async function getVisBoard(
  matchNo: number,
  now: number = Date.now(),
): Promise<Aged<VisBoardData> & { pollMs: number }> {
  const hit = boards.get(matchNo);
  if (fresh(hit, now)) return withPoll(aged(hit!, now), hit!);

  return dedupe(`board:${matchNo}`, async () => {
    try {
      // The Version handshake (spec/43): ask only for what has changed since
      // the payload we already hold.
      let xml = await visRequest(
        volleyLiveEnvelope(matchNo, undefined, hit?.visVersion ?? 0),
      );
      if (isNoChanges(xml)) {
        if (hit) {
          // Nothing moved. The READ is fresh — so `at` advances and the board
          // stops being served as stale — but the payload, and therefore
          // `changedAt`, is untouched: spec/41's frozen-feed detector depends
          // on `changedAt` meaning "the score actually moved".
          const stamp = Date.now();
          const entry: Entry<VisBoardData> = {
            ...hit,
            at: stamp,
            ttlMs: pollIntervalMs(hit.value),
          };
          boards.set(matchNo, entry);
          return withPoll(aged(entry, stamp), entry);
        }
        // A version we cannot have come by honestly, or a cache dropped under
        // us mid-flight: ask again for everything.
        xml = await visRequest(volleyLiveEnvelope(matchNo, undefined, 0));
      }

      const board = buildBoardFromXml(matchNo, xml, { audit: true });
      // A live envelope for a match VIS has no live store for comes back
      // without a Match element; mapVolleyLive then has nothing to say.
      const usable = board.teamA.name || board.teamB.name || board.sets.length > 0;
      if (usable) {
        const prev = boards.get(matchNo);
        const stamp = Date.now();
        const entry: Entry<VisBoardData> = {
          value: board,
          at: stamp,
          ttlMs: pollIntervalMs(board),
          changedAt:
            prev && boardPulse(prev.value) === boardPulse(board)
              ? prev.changedAt
              : stamp,
          visVersion: payloadVersion(xml),
        };
        boards.set(matchNo, entry);
        return withPoll(aged(entry, stamp), entry);
      }
      throw new Error("no live data");
    } catch (liveErr) {
      // A board with PLAY behind it must never be replaced by the pre-start
      // frame. `mapVolleyMatch` has no score and no sets by design, so caching
      // it over a live board turns a momentary VIS failure into a scoreboard
      // reading 0-0 in the middle of a set — which is exactly what a venue saw
      // on match 27553, 2026-08-20, while VIS itself was answering correctly
      // again. A slightly stale score is always better than a wrong one, and
      // the status page's `changedAt` is what surfaces a feed that has stopped.
      if (hit && (hit.value.sets.length > 0 || hit.value.status !== "UPCOMING")) {
        return withPoll(aged(hit, Date.now()), hit);
      }
      // Pre-start fallback: teams + kick-off time, refreshed slowly.
      try {
        const xml = await visRequest(volleyMatchEnvelope(matchNo));
        const board = mapVolleyMatch(xml, matchNo);
        if (board) {
          const entry: Entry<VisBoardData> = {
            value: board,
            at: Date.now(),
            ttlMs: UPCOMING_TTL_MS,
            changedAt: boards.get(matchNo)?.changedAt ?? Date.now(),
          };
          boards.set(matchNo, entry);
          return withPoll(aged(entry, Date.now()), entry);
        }
      } catch {
        /* fall through to stale/throw */
      }
      if (hit) return withPoll(aged(hit, Date.now()), hit);
      throw liveErr;
    }
  });
}

/**
 * A board built from VolleyStation (spec/45 W3).
 *
 * Cached in its OWN map, keyed by the same VIS match number, so one match can
 * be held from both feeds simultaneously — which is the point of §6bis: two
 * screens, two sources, one match, compared live.
 *
 * Stats and rosters move far more slowly than the score, so they are fetched on
 * their own cadence and reused; a stats fetch that fails costs the points
 * column, never the board.
 */
async function getVsBoard(
  matchNo: number,
  target: VsTarget,
  now: number = Date.now(),
): Promise<Aged<VisBoardData> & { pollMs: number }> {
  const hit = vsBoards.get(matchNo);
  if (fresh(hit, now)) return withPoll(aged(hit!, now), hit!);

  return dedupe(`vs-board:${matchNo}`, async () => {
    const { link } = target;
    const id = link.championshipMatchId;
    const [match, home, guest] = await Promise.all([
      vsMatch(id, link.token),
      link.homeTeamId != null ? teamOf(link.homeTeamId, link.token) : Promise.resolve(null),
      link.guestTeamId != null ? teamOf(link.guestTeamId, link.token) : Promise.resolve(null),
    ]);

    // The verification belt (spec/45 W2.3), applied to the exact match about to
    // be rendered: the two systems must name the same two teams. A number join
    // alone would put one match's score on another match's screen, so a pair
    // that cannot be confirmed is refused and the caller falls back to VIS.
    const vsCodes = [home, guest]
      .map((t) => t?.ShortCodeName?.toUpperCase())
      .filter((c): c is string => !!c);
    if (vsCodes.length !== 2 || !vsCodes.every((c) => link.visCodes.includes(c))) {
      throw new Error(
        `VolleyStation match ${id} names [${vsCodes}] where VIS ${matchNo} names [${link.visCodes}]`,
      );
    }

    const statsHit = vsStatsCache.get(id);
    let stats = statsHit?.value ?? null;
    if (!statsHit || Date.now() - statsHit.at > VS_STATS_TTL_MS) {
      try {
        stats = await vsStats(id, link.token);
        vsStatsCache.set(id, { value: stats, at: Date.now() });
      } catch {
        // Keep whatever we had; the points column is not worth a blank board.
      }
    }

    // The VIS schedule row is already cached (the route builds the allowlist
    // from it), and it is the better source for two things VolleyStation states
    // differently: the kick-off in VENUE-local time, and the pool.
    const summary = await visSummaryFor(matchNo).catch(() => null);

    const board = mapVsBoard({
      match,
      stats,
      config: link.config,
      rosterHome: rosterOf(home),
      rosterGuest: rosterOf(guest),
      codeHome: home?.ShortCodeName ?? summary?.teamACode ?? null,
      codeGuest: guest?.ShortCodeName ?? summary?.teamBCode ?? null,
      scheduledLocal:
        summary?.dateLocal
          ? `${summary.dateLocal}${summary.timeLocal ? ` ${summary.timeLocal}` : ""}`
          : null,
      matchNo,
    });

    // A finished match has no live state, so VolleyStation's widget carries no
    // line-up at all and the six come back empty. VIS keeps the last rally's,
    // so borrow it rather than show an empty court — visible on the U-shape and
    // on ?screen=board, where a finished board does not switch to statistics.
    const borrowed =
      board.status === "FINISHED" && board.teamA.players.length === 0
        ? await borrowSixFromVis(matchNo, board)
        : board;

    const prev = vsBoards.get(matchNo);
    const stamp = Date.now();
    // A rally is in progress: a point is seconds away, so ask more often for
    // exactly as long as that is true (spec/45 — VolleyStation tells us, VIS
    // cannot).
    const inRally = match.widget?.in_rally === true && board.status === "LIVE";
    const entry: Entry<VisBoardData> = {
      value: borrowed,
      at: stamp,
      ttlMs: Math.min(pollIntervalMs(borrowed), inRally ? VS_IN_RALLY_MS : Infinity),
      changedAt:
        prev && boardPulse(prev.value) === boardPulse(borrowed) ? prev.changedAt : stamp,
    };
    vsBoards.set(matchNo, entry);
    return withPoll(aged(entry, stamp), entry);
  });
}

/**
 * The VIS schedule row for a match, from the list this instance already holds.
 * Never fetches on its own: if the allowlist has not been built here yet, the
 * VolleyStation board simply goes without the venue-local kick-off.
 */
async function visSummaryFor(matchNo: number): Promise<VisMatchSummary | null> {
  const tournamentNo = await tournamentOfMatch(matchNo);
  if (tournamentNo == null) return null;
  const list = matchLists.get(tournamentNo);
  return list?.value.find((m) => m.matchNo === matchNo) ?? null;
}

/**
 * matchNo → tournamentNo for every match of every VIS-linked competition.
 * Rebuilt every 10 minutes; a match number absent from it is not servable.
 */
async function getAllowlist(now: number = Date.now()): Promise<Map<number, number>> {
  if (fresh(allowlist, now)) return allowlist!.value;
  return dedupe("allowlist", async () => {
    const rows = await db
      .select({ visTournamentNo: competitions.visTournamentNo })
      .from(competitions)
      .where(isNotNull(competitions.visTournamentNo));
    const tournaments = [
      ...new Set(rows.map((r) => r.visTournamentNo).filter((n): n is number => n != null)),
    ];
    const map = new Map<number, number>();
    for (const t of tournaments) {
      try {
        const { value } = await getMatchList(t);
        for (const m of value) map.set(m.matchNo, t);
      } catch {
        // One unreachable tournament must not close the door on the others;
        // keep whatever the previous allowlist knew about it.
        if (allowlist) {
          for (const [mNo, tNo] of allowlist.value) if (tNo === t) map.set(mNo, tNo);
        }
      }
    }
    allowlist = {
      value: map, at: Date.now(), ttlMs: ALLOWLIST_TTL_MS, changedAt: Date.now(),
    };
    return map;
  });
}

/** True when `matchNo` belongs to a VIS-linked competition on this platform. */
export async function isKnownMatch(matchNo: number): Promise<boolean> {
  return (await getAllowlist()).has(matchNo);
}

/** The VIS tournament a known match belongs to, or null. */
export async function tournamentOfMatch(matchNo: number): Promise<number | null> {
  return (await getAllowlist()).get(matchNo) ?? null;
}

/** A tenant's VIS-linked competition, or null when it isn't one. */
export async function getVisCompetition(
  tenantId: string,
  competitionId: string,
): Promise<{
  id: string;
  name: string;
  visTournamentNo: number;
  city: string | null;
  country: string | null;
} | null> {
  const rows = await db
    .select({
      id: competitions.id,
      tenantId: competitions.tenantId,
      name: competitions.name,
      visTournamentNo: competitions.visTournamentNo,
      city: competitions.city,
      country: competitions.country,
    })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId || row.visTournamentNo == null) return null;
  return {
    id: row.id,
    name: row.name,
    visTournamentNo: row.visTournamentNo,
    city: row.city,
    country: row.country,
  };
}

/**
 * The validation mock (spec/35 W9): VNL 2025 QF Japan-Poland at its latest
 * stage, rendered as if live. Mapped from the embedded capture on every call —
 * it never touches VIS, so it needs no cache and cannot go stale.
 */
export function getMockBoard(now: number = Date.now()): Aged<VisBoardData> {
  return {
    value: mapVolleyLive(mockLiveXml(), MOCK_MATCH_NO, now),
    ageSeconds: 0,
  };
}

export { MOCK_LABEL, MOCK_MATCH_NO } from "./mock";
export { REPLAY_LABEL, REPLAY_MATCH_NO } from "./replay";

/**
 * The replay board (spec/44): a real match, always in progress, never VIS.
 *
 * Unlike the mock — which bypasses everything to render one frozen frame — this
 * goes through `buildBoardFromXml`, the same function the live path uses. The
 * cadence transitions, the stabiliser, spec/43's enforcement and the CDN
 * headers are therefore all exercised for real, which is the point: it
 * validates the machinery and not merely the pixels.
 *
 * `audit: false` is a hard requirement, not a preference. A replayed match must
 * never write a row into `vis_rotation_log`: fiction in the evidence table
 * would poison the very verdicts spec/42 and spec/43 exist to gather.
 */
export function getReplayBoard(
  now: number = Date.now(),
  opts: { chaos?: boolean; speed?: number } = {},
): Aged<VisBoardData> {
  const hit = boards.get(REPLAY_MATCH_NO);
  if (fresh(hit, now)) return aged(hit!, now);

  const xml = replayXml(now, opts);
  const board = buildBoardFromXml(REPLAY_MATCH_NO, xml, { audit: false, now });
  const entry: Entry<VisBoardData> = {
    value: board,
    at: now,
    ttlMs: pollIntervalMs(board),
    changedAt:
      hit && boardPulse(hit.value) === boardPulse(board) ? hit.changedAt : now,
    visVersion: payloadVersion(xml),
  };
  boards.set(REPLAY_MATCH_NO, entry);
  return aged(entry, now);
}

/**
 * One VIS live payload → the board it renders (spec/43 §7.1).
 *
 * Everything between "XML in hand" and "board built" lives here, so that the
 * live path and the replay board (spec/44) go through IDENTICAL machinery
 * rather than two implementations that drift. `audit` is the only difference
 * between them: a replayed match must not write rows into the evidence table.
 */
export function buildBoardFromXml(
  matchNo: number,
  xml: string,
  opts: {
    audit: boolean;
    /**
     * The instant to read the payload AT. Defaults to the wall clock, which is
     * what a live poll wants; the replay board (spec/44) passes the frame's own
     * time so that its UPCOMING/LIVE/FINISHED transitions are judged against
     * the clock the frame was built for rather than against the real one.
     */
    now?: number;
  },
): VisBoardData {
  const now = opts.now ?? Date.now();
  const sets = tagBlocks(xml, "Set").sort(
    (a, b) => num(a.attrs, "No") - num(b.attrs, "No"),
  );
  const latestSet = sets[sets.length - 1] ?? null;
  const setNo = num(latestSet?.attrs, "No", 0);
  const rallyCount = latestSet
    ? (latestSet.inner.match(/<Rally\b/g) ?? []).length
    : 0;

  // Only knowable before a set's first rally, and the reason the opening
  // point of a set can be judged a side-out (spec/42).
  noteFirstServer(matchNo, setNo, rallyCount, mapVolleyLive(xml, matchNo).serving);
  const firstServer = firstServerFor(matchNo, setNo);

  // The rules decide where the six are standing (spec/43); the feed decides
  // everything else on the board.
  const enforced = enforceRotation(xml, latestSet, firstServer);
  const board = stabiliseLineups(
    matchNo,
    mapVolleyLive(xml, matchNo, now, firstServer, {
      A: enforced.A,
      B: enforced.B,
    }),
    rallyCount,
    { A: !!enforced.A, B: !!enforced.B },
  );

  if (opts.audit) {
    // Background only: record where the feed and the rules part company, with
    // the verdict the serve action gives. Nothing here reaches a screen, and
    // every failure is swallowed inside — a board must not depend on its own
    // instrumentation.
    void shadowRotation(xml, matchNo, latestSet, setNo, enforced);
  }
  return board;
}

/**
 * Fill a VolleyStation board's empty six from the VIS reading of the same match.
 *
 * The sides are matched by TEAM CODE, never by position: VolleyStation's home
 * and guest need not be VIS's A and B — the mapping's own verification belt
 * compares the two as a SET for exactly that reason — and getting it backwards
 * would put one team's players under the other's name.
 *
 * Never throws and never blocks: a VIS read that fails simply leaves the board
 * as it was, which is what it would have been anyway.
 */
async function borrowSixFromVis(
  matchNo: number,
  board: VisBoardData,
): Promise<VisBoardData> {
  try {
    const vis = (await getVisBoard(matchNo)).value;
    const pick = (code: string) =>
      code && vis.teamA.code === code
        ? vis.teamA.players
        : code && vis.teamB.code === code
          ? vis.teamB.players
          : [];
    const a = pick(board.teamA.code);
    const b = pick(board.teamB.code);
    if (a.length === 0 && b.length === 0) return board;
    return {
      ...board,
      teamA: { ...board.teamA, players: a },
      teamB: { ...board.teamB, players: b },
    };
  } catch {
    return board;
  }
}

const NO_ENFORCEMENT: EnforcedLineups = {
  A: null,
  B: null,
  basis: "fallback",
  firstServer: null,
  confidence: "unknown",
  notes: [],
};

/**
 * The enforced rotation for the set in play, or nothing at all.
 *
 * Defensive by construction: this runs in the request path of a live board, so
 * any failure to work it out degrades to the feed's own lineup (spec/43 §6
 * fallback) rather than to a blank screen.
 */
function enforceRotation(
  xml: string,
  latestSet: { attrs: Attrs; inner: string } | null,
  remembered: ReturnType<typeof firstServerFor>,
): EnforcedLineups {
  try {
    if (!latestSet) return NO_ENFORCEMENT;
    const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
    const noTeamA = num(match, "NoTeamA", -1);
    const noTeamB = num(match, "NoTeamB", -2);
    const sides = playerSides(xml, noTeamA, noTeamB);
    // The set's OWN lineups — the registered starting six — are the rows before
    // its `Events`; everything after belongs to a rally.
    const head = latestSet.inner.split("<Events")[0];
    const startingFor = (noTeam: number) => {
      const row = allTagAttrs(head, "LineUp").find(
        (l) => num(l, "NoTeam", -99) === noTeam,
      );
      return row ? sixOf(row) : null;
    };
    return enforceLineups({
      events: parseSetEvents(latestSet.inner, { noTeamA, noTeamB, sides }),
      startingLineups: { A: startingFor(noTeamA), B: startingFor(noTeamB) },
      liberos: designatedLiberos(latestSet.inner),
      sides,
      remembered,
    });
  } catch {
    return NO_ENFORCEMENT;
  }
}

/**
 * Run the rotation shadow for the payload just fetched (spec/42, spec/43).
 *
 * Fire-and-forget on purpose: it costs one comparison and, only on a first
 * divergence, one insert.
 */
async function shadowRotation(
  xml: string,
  matchNo: number,
  latestSet: { attrs: Attrs; inner: string } | null,
  setNo: number,
  enforced: EnforcedLineups,
): Promise<void> {
  try {
    if (!latestSet) return;
    // Belt and braces beside `audit: false`: a replayed match must never reach
    // the evidence table, whatever a future caller does (spec/44 §6.2).
    if (matchNo === REPLAY_MATCH_NO) return;
    const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
    const rows = auditSet({
      matchNo,
      setInner: latestSet.inner,
      setAttrs: latestSet.attrs,
      noTeamA: num(match, "NoTeamA", -1),
      noTeamB: num(match, "NoTeamB", -2),
      liberos: designatedLiberos(latestSet.inner),
    });
    await recordRotationAudit([
      ...rows,
      ...enforcementRows(matchNo, setNo, enforced),
    ]);
  } catch {
    // Instrumentation must never be able to take a board down.
  }
}

/**
 * A read-only look at what this instance has cached (spec/41).
 *
 * The caveat is load-bearing and the status page must say it out loud: these
 * caches are MODULE-LEVEL, so they belong to one serverless instance. A status
 * request can land on a different instance than the screen in the hall, and
 * then this is a true statement about an instance rather than about that TV.
 */
export interface VisStoreSnapshot {
  allowlist: { matches: number; tournaments: number; ageSeconds: number } | null;
  matchLists: { tournamentNo: number; rows: number; ageSeconds: number }[];
  boards: {
    matchNo: number;
    status: VisBoardData["status"];
    teamA: string;
    teamB: string;
    currentSet: number | null;
    scoreA: number;
    scoreB: number;
    inSetBreak: boolean;
    /** Age of the underlying VIS read. */
    ageSeconds: number;
    /** How long since the score, sets or serve actually moved. */
    sinceChangeSeconds: number;
    pollMs: number;
    /** The feed version this instance holds — what the next poll asks past. */
    visVersion: number;
    /** Which feed built this entry (spec/45). */
    source: BoardSource;
  }[];
}

export function visStoreSnapshot(now: number = Date.now()): VisStoreSnapshot {
  return {
    allowlist: allowlist
      ? {
          matches: allowlist.value.size,
          tournaments: new Set(allowlist.value.values()).size,
          ageSeconds: Math.round((now - allowlist.at) / 1000),
        }
      : null,
    matchLists: [...matchLists.entries()].map(([tournamentNo, e]) => ({
      tournamentNo,
      rows: e.value.length,
      ageSeconds: Math.round((now - e.at) / 1000),
    })),
    boards: [...boards.entries(), ...vsBoards.entries()].map(([matchNo, e]) => ({
      matchNo,
      status: e.value.status,
      teamA: e.value.teamA.code || e.value.teamA.name,
      teamB: e.value.teamB.code || e.value.teamB.name,
      currentSet: e.value.currentSet,
      scoreA: e.value.scoreA,
      scoreB: e.value.scoreB,
      inSetBreak: e.value.inSetBreak,
      ageSeconds: Math.round((now - e.at) / 1000),
      sinceChangeSeconds: Math.round((now - e.changedAt) / 1000),
      pollMs: e.ttlMs,
      visVersion: e.visVersion ?? 0,
      source: (vsBoards.get(matchNo) === e ? "vs" : "vis") as BoardSource,
    })),
  };
}

/** Test seam: drop every cache. */
export function __resetVisCaches(): void {
  matchLists.clear();
  boards.clear();
  vsBoards.clear();
  vsStatsCache.clear();
  inFlight.clear();
  allowlist = null;
}
