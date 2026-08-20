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

let mapping: Map<number, VsMatchLink> = new Map();
let mappingAt = 0;
let building: Promise<void> | null = null;

const teamCache = new Map<number, { value: VsTeam; at: number }>();
const teamInFlight = new Map<number, Promise<VsTeam>>();

interface LinkedCompetition {
  id: string;
  visTournamentNo: number;
  vsChampionshipId: number;
  boardSource: "vis" | "vs" | "auto";
}

async function linkedCompetitions(): Promise<LinkedCompetition[]> {
  const rows = await db
    .select({
      id: competitions.id,
      visTournamentNo: competitions.visTournamentNo,
      vsChampionshipId: competitions.vsChampionshipId,
      boardSource: competitions.boardSource,
    })
    .from(competitions)
    .where(isNotNull(competitions.vsChampionshipId));
  return rows.flatMap((r) =>
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
}

/** Rebuild every competition's mapping. Never throws. */
async function rebuild(): Promise<void> {
  const next = new Map<number, VsMatchLink>();
  try {
    if (!vsConfigured()) {
      mapping = next;
      mappingAt = Date.now();
      return;
    }
    for (const comp of await linkedCompetitions()) {
      try {
        const config = await vsChampionship(comp.vsChampionshipId);
        // Imported HERE rather than at the top of the file: the store imports
        // this module to choose a source, so a static import back into it is a
        // cycle. Under the app's load order the store is mid-initialisation
        // when this module is evaluated, and `getMatchList` would be undefined
        // — every mapping silently empty, every board quietly on VIS. It cost
        // an afternoon; a dynamic import is resolved at call time and cannot.
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
        let mapped = 0;
        for (const vm of vsList) {
          const num = vm.MatchNumber == null ? null : String(vm.MatchNumber);
          const vis = num ? visByNumber.get(num) : null;
          if (!vis) continue;
          const visCodes = [vis.teamACode, vis.teamBCode]
            .filter((c): c is string => !!c)
            .map((c) => c.toUpperCase());
          // A bracket placeholder has no teams on either side; it joins later.
          if (visCodes.length !== 2) continue;
          next.set(vis.matchNo, {
            championshipMatchId: vm.ChampionshipMatch_ID,
            championshipId: comp.vsChampionshipId,
            homeTeamId: vm.HomeTeam_ID,
            guestTeamId: vm.GuestTeam_ID,
            visCodes,
            config,
            boardSource: comp.boardSource,
          });
          mapped++;
        }
        console.info(
          `[vs-live] competition ${comp.id}: ${mapped}/${vsList.length} matches linked`,
        );
      } catch (err) {
        // One unreachable event must not cost the others their mapping.
        console.warn(
          `[vs-live] competition ${comp.id} not mapped: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
        );
      }
    }
    mapping = next;
  } catch {
    // Keep whatever we had rather than dropping every board to VIS.
  } finally {
    mappingAt = Date.now();
  }
}

/**
 * How long a board will wait for the mapping before giving up and using VIS.
 *
 * A background-only refresh sounds safer and is not: serverless instances are
 * short-lived and numerous, so "the next request will have it" is usually a
 * DIFFERENT instance starting cold, and VolleyStation would never be reached at
 * all. So the first request on an instance does wait — but never longer than
 * this, whatever the upstream is doing. A rebuild costs one cached
 * championships read plus one dated match list per competition, ~0.2 s each.
 */
const MAPPING_WAIT_MS = 2_500;

/**
 * The mapping, waiting for a rebuild only as long as a board can afford to.
 *
 * Whichever way this returns, the rebuild continues in the background, so an
 * instance that timed out once is serving VolleyStation a moment later.
 */
async function currentMapping(now: number = Date.now()): Promise<Map<number, VsMatchLink>> {
  if (now - mappingAt >= MAP_TTL_MS && !building) {
    building = rebuild().finally(() => {
      building = null;
    });
  }
  if (building && mapping.size === 0) {
    await Promise.race([
      building,
      new Promise((resolve) => setTimeout(resolve, MAPPING_WAIT_MS)),
    ]);
  }
  return mapping;
}

/** Warm the mapping and wait for it — for scripts and tests, never a board. */
export async function ensureMapping(): Promise<Map<number, VsMatchLink>> {
  if (Date.now() - mappingAt >= MAP_TTL_MS || mapping.size === 0) {
    building = building ?? rebuild().finally(() => (building = null));
    await building;
  }
  return mapping;
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
  const link = (await currentMapping()).get(matchNo);
  return link ? { link } : null;
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
  const target = await vsTargetFor(matchNo);
  if (requested === "vs") return { source: target ? "vs" : "vis", target };
  const wants = target?.link.boardSource ?? "vis";
  const useVs = target != null && (wants === "vs" || wants === "auto");
  return { source: useVs ? "vs" : "vis", target: useVs ? target : null };
}

/** Test seam. */
export function __resetVsResolve(): void {
  mapping = new Map();
  mappingAt = 0;
  building = null;
  teamCache.clear();
  teamInFlight.clear();
}
