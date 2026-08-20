/**
 * Which VolleyStation match is this VIS match? (spec/45 W2.3)
 *
 * There is no stored key joining the two systems: `fivb_id` and `external_ids`
 * exist on every VolleyStation match and are EMPTY on all 12,768 of them. What
 * does hold, measured across 168 matches of three events, is
 *
 *     VS.MatchNumber === VIS.NoInTournament   (within one championship↔tournament)
 *
 * A number join alone would be reckless — the number is only unique inside its
 * own event, and a mis-mapped board puts one match's score on another match's
 * screen. So every board VERIFIES its pair against a second, independent fact
 * before rendering it: the two systems' team codes are the same codes
 * (`VS.Team.ShortCodeName === VIS.TeamACode`, e.g. TPE). That check lives at
 * BOARD time rather than at map time, for two reasons — it is then made against
 * the exact match being shown, and it uses the two team records the board needs
 * for its player names anyway.
 *
 * TWO shapes of upstream failure this module is built around, both measured:
 *
 *  - `Teams/?Championship_ID=N` answers instantly at times and HANGS at others
 *    (three consecutive 25-30 s timeouts on a query that had been fast an hour
 *    earlier). Nothing here calls it: teams are fetched one at a time by id,
 *    which stayed at ~176 ms throughout, and cached for hours.
 *  - Undated `Matches/` list queries are rate-limited with HTTP 429.
 *
 * And one rule that follows from them: **the mapping is never built inside a
 * board's request.** A cold instance answers from VIS and refreshes the mapping
 * in the background, so VolleyStation's latency can never become the board's.
 */

import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import {
  vsChampionship,
  vsChampionshipMatches,
  vsConfigured,
  vsTeam,
} from "./client";
import type { VsChampionship, VsTeam } from "./types";

export type BoardSource = "vis" | "vs";

export interface VsMatchLink {
  championshipMatchId: number;
  championshipId: number;
  /** VS team ids, for the roster fetch and the verification. */
  homeTeamId: number | null;
  guestTeamId: number | null;
  /** The VIS three-letter codes for this match — what the codes must equal. */
  visCodes: string[];
  config: VsChampionship | null;
  boardSource: "vis" | "vs" | "auto";
}

const MAP_TTL_MS = 10 * 60_000;
/** Rosters change per event, not per rally. */
const TEAM_TTL_MS = 6 * 3600_000;
/** The linked-competition list is a cheap DB read, but not a per-request one. */
const LINKS_TTL_MS = 60_000;

/** Per COMPETITION, not global: a board must only pay for its own event. */
const perCompetition = new Map<
  string,
  { value: Map<number, VsMatchLink>; at: number; building: Promise<void> | null }
>();
let links: { value: LinkedCompetition[]; at: number } | null = null;

const teamCache = new Map<number, { value: VsTeam; at: number }>();
const teamInFlight = new Map<number, Promise<VsTeam>>();

interface LinkedCompetition {
  id: string;
  visTournamentNo: number;
  vsChampionshipId: number;
  boardSource: "vis" | "vs" | "auto";
}

async function linkedCompetitions(): Promise<LinkedCompetition[]> {
  if (links && Date.now() - links.at < LINKS_TTL_MS) return links.value;
  const rows = await db
    .select({
      id: competitions.id,
      visTournamentNo: competitions.visTournamentNo,
      vsChampionshipId: competitions.vsChampionshipId,
      boardSource: competitions.boardSource,
    })
    .from(competitions)
    .where(isNotNull(competitions.vsChampionshipId));
  const value = rows.flatMap((r) =>
    r.visTournamentNo != null && r.vsChampionshipId != null
      ? [
          {
            id: r.id,
            visTournamentNo: r.visTournamentNo,
            vsChampionshipId: r.vsChampionshipId,
            boardSource: r.boardSource,
          },
        ]
      : [],
  );
  links = { value, at: Date.now() };
  return value;
}

/** Build ONE competition's mapping. Never throws — no mapping means VIS. */
async function buildOne(comp: LinkedCompetition): Promise<Map<number, VsMatchLink>> {
  const out = new Map<number, VsMatchLink>();
  try {
    const config = await vsChampionship(comp.vsChampionshipId);
    // Imported HERE rather than at the top of the file: the store imports this
    // module to choose a source, so a static import back into it is a cycle.
    // Under the app's load order the store is mid-initialisation when this
    // module is evaluated, and `getMatchList` would be undefined — every
    // mapping silently empty, every board quietly on VIS. It cost an afternoon;
    // a dynamic import is resolved at call time and cannot.
    const { getMatchList } = await import("@/lib/vis-live/store");
    const [visList, vsList] = await Promise.all([
      getMatchList(comp.visTournamentNo),
      vsChampionshipMatches(
        comp.vsChampionshipId,
        (config as unknown as { DateFrom?: string })?.DateFrom ?? null,
        (config as unknown as { DateTo?: string })?.DateTo ?? null,
      ),
    ]);

    const visByNumber = new Map(
      visList.value
        .filter((m) => m.numberInTournament != null)
        .map((m) => [String(m.numberInTournament), m]),
    );
    for (const vm of vsList) {
      const num = vm.MatchNumber == null ? null : String(vm.MatchNumber);
      const vis = num ? visByNumber.get(num) : null;
      if (!vis) continue;
      const visCodes = [vis.teamACode, vis.teamBCode]
        .filter((c): c is string => !!c)
        .map((c) => c.toUpperCase());
      // A bracket placeholder has no teams on either side; it joins later.
      if (visCodes.length !== 2) continue;
      out.set(vis.matchNo, {
        championshipMatchId: vm.ChampionshipMatch_ID,
        championshipId: comp.vsChampionshipId,
        homeTeamId: vm.HomeTeam_ID,
        guestTeamId: vm.GuestTeam_ID,
        visCodes,
        config,
        boardSource: comp.boardSource,
      });
    }
    console.info(`[vs-live] ${comp.id}: ${out.size}/${vsList.length} matches linked`);
  } catch (err) {
    console.warn(
      `[vs-live] ${comp.id} not mapped: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
    );
  }
  return out;
}

/**
 * How long a board will wait for its competition's mapping before using VIS.
 *
 * A background-only refresh sounds safer and is not: serverless instances are
 * short-lived and numerous, so "the next request will have it" is usually a
 * DIFFERENT instance starting cold, and VolleyStation would never be reached at
 * all. So the first request on an instance does wait — but never longer than
 * this, whatever the upstream is doing.
 *
 * It is affordable because a board maps only ITS OWN event: one cached
 * championships read, one VIS match list (already warm, the route builds the
 * allowlist from it before calling us) and one dated VolleyStation list. Mapping
 * every linked competition instead — which is what this used to do — lost the
 * race on a cold instance and quietly served VIS all afternoon.
 */
const MAPPING_WAIT_MS = 2_500;

/** The mapping for one competition, waiting only as long as a board can. */
async function mappingFor(
  comp: LinkedCompetition,
): Promise<Map<number, VsMatchLink>> {
  const hit = perCompetition.get(comp.id);
  if (hit && Date.now() - hit.at < MAP_TTL_MS) return hit.value;

  const entry = hit ?? { value: new Map<number, VsMatchLink>(), at: 0, building: null };
  perCompetition.set(comp.id, entry);
  if (!entry.building) {
    entry.building = buildOne(comp)
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
      })
      .finally(() => {
        entry.building = null;
      });
  }
  // A mapping we already hold is served immediately while it refreshes behind.
  if (entry.value.size === 0) {
    await Promise.race([
      entry.building,
      new Promise((resolve) => setTimeout(resolve, MAPPING_WAIT_MS)),
    ]);
  }
  return entry.value;
}

/** The linked competition that owns this VIS match, if any. */
async function competitionForMatch(matchNo: number): Promise<LinkedCompetition | null> {
  const all = await linkedCompetitions();
  if (all.length === 0) return null;
  const { tournamentOfMatch } = await import("@/lib/vis-live/store");
  const tournamentNo = await tournamentOfMatch(matchNo).catch(() => null);
  if (tournamentNo == null) return null;
  return all.find((c) => c.visTournamentNo === tournamentNo) ?? null;
}

/** Warm every mapping and wait — for scripts and tests, never a board. */
export async function ensureMapping(): Promise<Map<number, VsMatchLink>> {
  const out = new Map<number, VsMatchLink>();
  if (!vsConfigured()) return out;
  for (const comp of await linkedCompetitions().catch(() => [])) {
    const one = await buildOne(comp);
    perCompetition.set(comp.id, { value: one, at: Date.now(), building: null });
    for (const [k, v] of one) out.set(k, v);
  }
  return out;
}

/** One team, cached for hours; the last good copy survives an outage. */
export async function teamOf(teamId: number): Promise<VsTeam | null> {
  const hit = teamCache.get(teamId);
  if (hit && Date.now() - hit.at < TEAM_TTL_MS) return hit.value;
  const running = teamInFlight.get(teamId);
  if (running) return running.catch(() => hit?.value ?? null);
  const p = vsTeam(teamId).finally(() => teamInFlight.delete(teamId));
  teamInFlight.set(teamId, p);
  try {
    const value = await p;
    teamCache.set(teamId, { value, at: Date.now() });
    return value;
  } catch {
    // Stale roster names beat none; no roster at all means the board falls back.
    return hit?.value ?? null;
  }
}

/** Shirt number → display name for one team. */
export function rosterOf(team: VsTeam | null): Map<number, string> | null {
  if (!team) return null;
  const out = new Map<number, string>();
  for (const p of team.PlayerList ?? []) {
    if (p.Number == null) continue;
    out.set(p.Number, p.Player_ShirtName || p.Player_Surname || `#${p.Number}`);
  }
  return out;
}

export interface VsTarget {
  link: VsMatchLink;
}

/** The VolleyStation match behind a VIS match number, or null. */
export async function vsTargetFor(matchNo: number): Promise<VsTarget | null> {
  const comp = await competitionForMatch(matchNo);
  if (!comp) return null;
  const link = (await mappingFor(comp)).get(matchNo);
  return link ? { link } : null;
}

/**
 * Which feed a competition is set to serve, read as FRESHLY as the lever needs.
 *
 * Deliberately not taken from the mapping, even though the mapping carries a
 * copy: that is cached for ten minutes, and this setting is the emergency
 * control. "VolleyStation is misbehaving at 18-17 in the fourth, put every
 * screen back on VIS" cannot mean waiting ten minutes for a cache to turn over.
 * The linked-competition list is a single indexed read cached for a minute, so
 * a change lands within about a poll of that.
 */
async function configuredSource(matchNo: number): Promise<"vis" | "vs" | "auto"> {
  const comp = await competitionForMatch(matchNo).catch(() => null);
  return comp?.boardSource ?? "vis";
}

/**
 * Which source should serve this match, given the competition's setting and an
 * optional per-screen override.
 *
 * `auto` and `vs` both mean "VolleyStation when we can"; keeping them distinct
 * lets `vs` grow a louder failure mode later without re-migrating.
 */
export async function sourceFor(
  matchNo: number,
  requested?: BoardSource | null,
): Promise<{ source: BoardSource; target: VsTarget | null }> {
  // A screen pinned to VIS must not pay for a mapping it will not use.
  if (requested === "vis") return { source: "vis", target: null };
  if (requested === "vs") {
    const target = await vsTargetFor(matchNo);
    return { source: target ? "vs" : "vis", target };
  }
  // No override: the competition's own setting decides, read fresh (above).
  const wants = await configuredSource(matchNo);
  if (wants === "vis") return { source: "vis", target: null };
  const target = await vsTargetFor(matchNo);
  const useVs = target != null;
  return { source: useVs ? "vs" : "vis", target: useVs ? target : null };
}

/** Test seam. */
export function __resetVsResolve(): void {
  perCompetition.clear();
  links = null;
  teamCache.clear();
  teamInFlight.clear();
}
