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

/**
 * Every VolleyStation token this deployment holds.
 *
 * There is more than one because a token does NOT see all of FIVB: the scopes
 * are disjoint in practice. Measured 2026-08-20, one token sees the AVC
 * championships and the VNL rehearsal and returns ZERO matches for the U17
 * World Championships; a second sees both U17 events and returns zero for the
 * AVC ones. Swapping one for the other would have taken the AVC boards off
 * VolleyStation while putting the U17s on it.
 *
 * So the tokens are a LIST, and which one serves a championship is discovered
 * rather than configured — see `championshipIndex`.
 *
 * `VOLLEYSTATION_KEYS` is comma-separated; `VOLLEYSTATION_KEY` remains valid
 * for a single token.
 */
export function vsTokens(): string[] {
  const many = process.env.VOLLEYSTATION_KEYS?.trim();
  const one = process.env.VOLLEYSTATION_KEY?.trim();
  const raw = many || one || "";
  return [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
}

/** True when this deployment is configured to talk to VolleyStation at all. */
export function vsConfigured(): boolean {
  return vsTokens().length > 0;
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
export async function vsGet<T>(path: string, token?: string): Promise<T> {
  assertAllowed(path);
  const key = token?.trim() || vsTokens()[0];
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
export function vsMatch(championshipMatchId: number, token?: string): Promise<VsMatch> {
  return vsGet<VsMatch>(`Matches/${championshipMatchId}/`, token);
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
  token?: string,
): Promise<VsMatch[]> {
  const to = toIso ? `&MatchDateTime__lte=${encodeURIComponent(toIso)}` : "";
  return vsGet<VsMatch[]>(
    `Matches/?Championship_ID=${championshipId}&MatchDateTime__gte=${encodeURIComponent(fromIso)}${to}`,
    token,
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
export function vsTeam(teamId: number, token?: string): Promise<VsTeam> {
  return vsGet<VsTeam>(`Teams/${teamId}/`, token);
}

/**
 * Every team of a championship. Kept for scripts and exploration; NOT used by
 * the board path, for the reason above.
 */
export function vsTeams(championshipId: number): Promise<VsTeam[]> {
  return vsGet<VsTeam[]>(`Teams/?Championship_ID=${championshipId}`);
}

export function vsStats(
  championshipMatchId: number,
  token?: string,
): Promise<VsStatsRow[]> {
  return vsGet<VsStatsRow[]>(
    `MatchStatsSheet/?ChampionshipMatchID=${championshipMatchId}`,
    token,
  );
}

/**
 * Which token owns which championship, and what that championship says.
 *
 * `Championships/` returns exactly the list a token can see, so asking each
 * token once is a complete and self-maintaining answer to "who serves this
 * event" — no per-competition token configuration to keep in step with
 * whatever VolleyStation grants next.
 *
 * The list is ~890 KB for a broad token, so it is fetched once an hour per
 * instance: without that, a mapping rebuild would pay it per linked
 * competition, which was most of what a rebuild cost.
 *
 * A token that fails is skipped rather than fatal — the others still answer,
 * and their championships still work.
 */
interface Owned {
  config: VsChampionship;
  token: string;
}
let index: { value: Map<number, Owned>; at: number } | null = null;
let indexing: Promise<Map<number, Owned>> | null = null;
const CHAMPIONSHIPS_TTL_MS = 3600_000;

async function championshipIndex(): Promise<Map<number, Owned>> {
  if (index && Date.now() - index.at < CHAMPIONSHIPS_TTL_MS) return index.value;
  if (indexing) return indexing;
  indexing = (async () => {
    const map = new Map<number, Owned>();
    for (const token of vsTokens()) {
      try {
        for (const config of await vsGet<VsChampionship[]>("Championships/", token)) {
          // First token to claim a championship keeps it. Two tokens seeing the
          // same event is fine; either would serve it.
          if (!map.has(config.Championship_ID)) map.set(config.Championship_ID, { config, token });
        }
      } catch (err) {
        console.warn(
          `[vs-live] a VolleyStation token could not list championships: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
        );
      }
    }
    index = { value: map, at: Date.now() };
    return map;
  })().finally(() => {
    indexing = null;
  });
  return indexing;
}

/** The championship's config and the token that can read it, or null. */
export async function vsChampionshipOwner(id: number): Promise<Owned | null> {
  return (await championshipIndex()).get(id) ?? null;
}

export async function vsChampionship(id: number): Promise<VsChampionship | null> {
  return (await vsChampionshipOwner(id))?.config ?? null;
}

/** Test seam. */
export function __resetVsClientCaches(): void {
  index = null;
  indexing = null;
}

/** A championship's schedule, widened a day either side of its own dates. */
export async function vsChampionshipMatches(
  championshipId: number,
  dateFrom: string | null,
  dateTo: string | null,
  token?: string,
): Promise<VsMatch[]> {
  const day = 86_400_000;
  const from = dateFrom ? new Date(Date.parse(dateFrom) - day) : new Date(Date.now() - 30 * day);
  const to = dateTo ? new Date(Date.parse(dateTo) + day) : null;
  return vsMatches(
    championshipId,
    from.toISOString().slice(0, 10),
    to ? to.toISOString().slice(0, 10) : undefined,
    token,
  );
}
