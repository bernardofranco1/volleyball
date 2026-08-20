/**
 * VolleyStation transport (spec/45 W1).
 *
 * THREE rules this module exists to enforce, each bought with evidence:
 *
 * 1. **GET only, ever.** The token answers `Allow: GET, HEAD, OPTIONS`, so a
 *    write should be impossible upstream — but the lesson of incident
 *    2026-07-29 is not "the server will stop me", it is that a write must be
 *    unreachable from our own code. There is no method parameter here to set.
 *    `/api/sync/` smells like a write trigger, was never probed, and is
 *    refused by name.
 *
 * 2. **Never fetch an unbounded collection.** Two endpoints will happily send
 *    the whole database: `Matches/` bare is 23.7 MB (12,768 rows) and
 *    `MatchStatsSheet/` bare is **77 MB** — and the stats sheet silently
 *    IGNORES an unrecognised filter, so a typo'd `?match=` returns all 77 MB
 *    with a 200. Both are refused here rather than documented.
 *
 * 3. **List calls must carry a date window.** VolleyStation rate-limits
 *    undated list queries with HTTP 429 and a body that names the remedy
 *    (`MatchDateTime__gte` / `__lte`). Measured 2026-08-20: undated repeats
 *    → 429; dated → 200 in ~180 ms, repeatedly. The per-match detail endpoint
 *    is not limited this way, which is what makes 1 Hz live polling viable.
 *
 * No retry loop: the caller's polling cadence IS the retry, and the store
 * falls back to VIS on any failure — the same argument spec/34 made for VIS.
 */

import type {
  VsChampionship,
  VsMatch,
  VsStatsRow,
  VsTeam,
} from "./types";

const DEFAULT_ENDPOINT = "https://panel.volleystation.com/api";
const TIMEOUT_MS = 8_000;

export class VsRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VsRequestError";
  }
}

/** True when this deployment is configured to talk to VolleyStation at all. */
export function vsConfigured(): boolean {
  return !!process.env.VOLLEYSTATION_KEY?.trim();
}

/**
 * Paths this module will fetch. Anything else is a bug, not a runtime
 * condition — so it throws rather than returning empty.
 */
function assertAllowed(path: string): void {
  if (/(^|\/)sync(\/|$|\?)/.test(path)) {
    throw new VsRequestError("refusing to call /sync — it is not a read (spec/45 §0)");
  }
  if (path.startsWith("MatchStatsSheet/")) {
    if (!/[?&]ChampionshipMatchID=\d+/.test(path)) {
      throw new VsRequestError(
        "refusing an unfiltered MatchStatsSheet — it returns ~77 MB; only " +
          "?ChampionshipMatchID= filters (a wrong parameter is IGNORED)",
      );
    }
    return;
  }
  if (path.startsWith("Matches/")) {
    const isDetail = /^Matches\/\d+\/?$/.test(path);
    if (isDetail) return;
    if (!/[?&]Championship_ID=\d+/.test(path)) {
      throw new VsRequestError(
        "refusing an unfiltered Matches list — it returns ~23.7 MB",
      );
    }
    if (!/[?&]MatchDateTime__gte=/.test(path)) {
      throw new VsRequestError(
        "refusing an undated Matches list — VolleyStation rate-limits these " +
          "(HTTP 429); pass MatchDateTime__gte",
      );
    }
    return;
  }
  if (path.startsWith("Teams/") || path.startsWith("Championships/")) return;
  throw new VsRequestError(`refusing an unrecognised VolleyStation path: ${path}`);
}

/**
 * GET one VolleyStation resource as JSON.
 *
 * Cloudflare fronts this API, so a challenge or an error page arrives as
 * non-JSON with a 200 as easily as a 5xx does. Both are transport failures
 * here, which the store turns into "use VIS instead" rather than a broken
 * board.
 */
export async function vsGet<T>(path: string): Promise<T> {
  assertAllowed(path);
  const key = process.env.VOLLEYSTATION_KEY?.trim();
  if (!key) {
    throw new VsRequestError("VOLLEYSTATION_KEY is not set — cannot reach VolleyStation");
  }
  const base = (process.env.VOLLEYSTATION_ENDPOINT?.trim() || DEFAULT_ENDPOINT).replace(/\/$/, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/${path}`, {
      method: "GET",
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // 429 carries a JSON body explaining itself; keep a little of it, since
      // "rate limited" and "match not found" want different responses from a
      // human reading the logs.
      throw new VsRequestError(`VolleyStation HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VsRequestError(`VolleyStation sent a non-JSON body: ${text.slice(0, 120)}`);
    }
  } catch (err) {
    if (err instanceof VsRequestError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new VsRequestError(`VolleyStation timed out after ${TIMEOUT_MS}ms`);
    }
    throw new VsRequestError(
      `VolleyStation request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One match, with its live `widget`. THE live poll: ~1.9 KB, ~120 ms. */
export function vsMatch(championshipMatchId: number): Promise<VsMatch> {
  return vsGet<VsMatch>(`Matches/${championshipMatchId}/`);
}

/**
 * A championship's matches within a date window.
 *
 * The window is mandatory upstream (see rule 3). Callers pass the event's own
 * `DateFrom`/`DateTo` where they have them; `vsChampionshipMatches` below
 * widens by a day at each end so a match that starts near midnight in the
 * panel's timezone cannot fall outside its own event.
 */
export function vsMatches(
  championshipId: number,
  fromIso: string,
  toIso?: string,
): Promise<VsMatch[]> {
  const to = toIso ? `&MatchDateTime__lte=${encodeURIComponent(toIso)}` : "";
  return vsGet<VsMatch[]>(
    `Matches/?Championship_ID=${championshipId}&MatchDateTime__gte=${encodeURIComponent(fromIso)}${to}`,
  );
}

/**
 * ONE team, by id — the only shape of this endpoint that can be relied on.
 *
 * `Teams/?Championship_ID=N` answers in milliseconds sometimes and hangs
 * indefinitely at others (measured 2026-08-20: three consecutive 25-30 s
 * timeouts on the same query that had returned instantly an hour earlier),
 * while `Teams/{id}/` stayed at ~176 ms throughout. A board needs exactly two
 * teams, and it has both ids on the match row, so it asks for exactly two.
 */
export function vsTeam(teamId: number): Promise<VsTeam> {
  return vsGet<VsTeam>(`Teams/${teamId}/`);
}

/**
 * Every team of a championship. Kept for scripts and exploration; NOT used by
 * the board path, for the reason above.
 */
export function vsTeams(championshipId: number): Promise<VsTeam[]> {
  return vsGet<VsTeam[]>(`Teams/?Championship_ID=${championshipId}`);
}

export function vsStats(championshipMatchId: number): Promise<VsStatsRow[]> {
  return vsGet<VsStatsRow[]>(`MatchStatsSheet/?ChampionshipMatchID=${championshipMatchId}`);
}

/**
 * Championships are returned as one un-paged list; there is no per-id detail
 * route, so this fetches all and picks. Cached hard by the caller — the list
 * is ~218 rows and changes when an event is created, not during one.
 */
export async function vsChampionship(id: number): Promise<VsChampionship | null> {
  const all = await vsGet<VsChampionship[]>("Championships/");
  return all.find((c) => c.Championship_ID === id) ?? null;
}

/** A championship's schedule, widened a day either side of its own dates. */
export async function vsChampionshipMatches(
  championshipId: number,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<VsMatch[]> {
  const day = 86_400_000;
  const from = dateFrom ? new Date(Date.parse(dateFrom) - day) : new Date(Date.now() - 30 * day);
  const to = dateTo ? new Date(Date.parse(dateTo) + day) : null;
  return vsMatches(
    championshipId,
    from.toISOString().slice(0, 10),
    to ? to.toISOString().slice(0, 10) : undefined,
  );
}
