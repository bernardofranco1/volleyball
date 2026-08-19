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
import { pollIntervalMs } from "./cadence";
import { tagBlocks, num, type Attrs } from "./parse";
import {
  auditSet,
  firstServerFor,
  liberosOf,
  noteFirstServer,
  recordRotationAudit,
} from "./rotation-audit";
import { stabiliseLineups } from "./lineup-stability";

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
}

const MATCH_LIST_TTL_MS = 60_000;
const UPCOMING_TTL_MS = 60_000;
const ALLOWLIST_TTL_MS = 10 * 60_000;

const matchLists = new Map<number, Entry<VisMatchSummary[]>>();
const boards = new Map<number, Entry<VisBoardData>>();
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
): Promise<Aged<VisBoardData>> {
  const hit = boards.get(matchNo);
  if (fresh(hit, now)) return aged(hit!, now);

  return dedupe(`board:${matchNo}`, async () => {
    try {
      const xml = await visRequest(volleyLiveEnvelope(matchNo));
      const sets = tagBlocks(xml, "Set").sort(
        (a, b) => num(a.attrs, "No") - num(b.attrs, "No"),
      );
      const latestSet = sets[sets.length - 1] ?? null;
      const setNo = num(latestSet?.attrs, "No", 0);
      const rallyCount = latestSet
        ? (latestSet.inner.match(/<Rally\b/g) ?? []).length
        : 0;

      const raw = mapVolleyLive(xml, matchNo);
      // Only knowable before a set's first rally, and the reason the opening
      // point of a set can now be judged a side-out (spec/42).
      noteFirstServer(matchNo, setNo, rallyCount, raw.serving);
      const board = stabiliseLineups(
        matchNo,
        mapVolleyLive(xml, matchNo, Date.now(), firstServerFor(matchNo, setNo)),
        rallyCount,
      );
      // Background only (spec/42): model the rotation independently and record
      // where VIS differs. Nothing here reaches a screen, and every failure is
      // swallowed inside — a board must not depend on its own instrumentation.
      void shadowRotation(xml, matchNo, latestSet);
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
        };
        boards.set(matchNo, entry);
        return aged(entry, stamp);
      }
      throw new Error("no live data");
    } catch (liveErr) {
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
          return aged(entry, Date.now());
        }
      } catch {
        /* fall through to stale/throw */
      }
      if (hit) return aged(hit, Date.now());
      throw liveErr;
    }
  });
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

/**
 * Run the rotation shadow for the payload just fetched (spec/42).
 *
 * Fire-and-forget on purpose: it costs one comparison and, only on a first
 * divergence, one insert. It also captures the first server of a set, which is
 * only knowable in the moment before that set's first rally exists.
 */
async function shadowRotation(
  xml: string,
  matchNo: number,
  latestSet: { attrs: Attrs; inner: string } | null,
): Promise<void> {
  try {
    if (!latestSet) return;
    const match = tagBlocks(xml, "Match")[0]?.attrs ?? null;
    const rows = auditSet({
      matchNo,
      setInner: latestSet.inner,
      setAttrs: latestSet.attrs,
      noTeamA: num(match, "NoTeamA", -1),
      noTeamB: num(match, "NoTeamB", -2),
      liberos: liberosOf(xml),
    });
    await recordRotationAudit(rows);
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
    boards: [...boards.entries()].map(([matchNo, e]) => ({
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
    })),
  };
}

/** Test seam: drop every cache. */
export function __resetVisCaches(): void {
  matchLists.clear();
  boards.clear();
  inFlight.clear();
  allowlist = null;
}
