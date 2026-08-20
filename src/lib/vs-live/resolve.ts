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
 * screen. So every pair is VERIFIED against a second, independent fact before
 * it is trusted: the two systems' team ids are the same ids
 * (`VS.Team.Code === VIS.NoTeam`, e.g. 9310 = Chinese Taipei). A pair whose
 * teams do not agree is DROPPED, not mapped.
 *
 * Compared as a SET, because home/guest need not be VIS's A/B, and because a
 * bracket placeholder ("TBD v TBD") resolves to no teams at all and must fall
 * out silently rather than map by number.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import { getMatchList } from "@/lib/vis-live/store";
import { vsChampionship, vsChampionshipMatches, vsConfigured, vsTeams } from "./client";
import type { VsChampionship } from "./types";

export type BoardSource = "vis" | "vs";

export interface VsMapping {
  /** VIS match number → VolleyStation ChampionshipMatch_ID. */
  matches: Map<number, number>;
  championshipId: number;
  /** The regulation config the board counts allowances down from. */
  config: VsChampionship | null;
  /** Shirt number → display name, per side of the VS match (home/guest). */
  rosters: Map<number, { home: number; guest: number }>;
  /** What the competition serves by default. */
  boardSource: "vis" | "vs" | "auto";
}

interface Entry {
  value: VsMapping | null;
  at: number;
}

const TTL_MS = 10 * 60_000;
/** competitionId → mapping. Module-level, so per serverless instance. */
const cache = new Map<string, Entry>();
/** VIS match number → the mapping that owns it, for the hot path. */
let byMatchNo: Map<number, VsMapping> | null = null;
let byMatchNoAt = 0;

const inFlight = new Map<string, Promise<unknown>>();
function dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

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

/**
 * Build one competition's mapping. Never throws: a competition whose VS side is
 * unreachable simply has no mapping, and every board of it stays on VIS.
 */
async function buildMapping(comp: LinkedCompetition): Promise<VsMapping | null> {
  try {
    const config = await vsChampionship(comp.vsChampionshipId);
    const [visList, vsList, teams] = await Promise.all([
      getMatchList(comp.visTournamentNo),
      vsChampionshipMatches(
        comp.vsChampionshipId,
        // The championship's own window, so the mandatory date filter is
        // derived rather than guessed (spec/45 §2 — undated lists are 429'd).
        (config as unknown as { DateFrom?: string })?.DateFrom ?? null,
        (config as unknown as { DateTo?: string })?.DateTo ?? null,
      ),
      vsTeams(comp.vsChampionshipId),
    ]);

    /** VS Team_ID → its VIS team number, from the shared id space. */
    const visTeamOf = new Map<number, number>();
    const rosterOf = new Map<number, Map<number, string>>();
    for (const t of teams) {
      const code = Number(t.Code);
      if (Number.isFinite(code)) visTeamOf.set(t.Team_ID, code);
      const byShirt = new Map<number, string>();
      for (const p of t.PlayerList ?? []) {
        if (p.Number == null) continue;
        byShirt.set(
          p.Number,
          p.Player_ShirtName || p.Player_Surname || `#${p.Number}`,
        );
      }
      rosterOf.set(t.Team_ID, byShirt);
    }

    const visByNumber = new Map<string, { matchNo: number; teams: Set<number> }>();
    for (const m of visList.value) {
      if (m.numberInTournament == null) continue;
      visByNumber.set(String(m.numberInTournament), {
        matchNo: m.matchNo,
        teams: new Set<number>(),
      });
    }
    // The list route does not carry NoTeamA/B, so the belt reads them from the
    // team codes instead: VIS TeamACode ("TPE") is VS ShortCodeName.
    const visCodeByNumber = new Map<string, Set<string>>();
    for (const m of visList.value) {
      if (m.numberInTournament == null) continue;
      const codes = new Set<string>();
      if (m.teamACode) codes.add(m.teamACode.toUpperCase());
      if (m.teamBCode) codes.add(m.teamBCode.toUpperCase());
      visCodeByNumber.set(String(m.numberInTournament), codes);
    }
    const shortCodeOf = new Map<number, string>();
    for (const t of teams) {
      if (t.ShortCodeName) shortCodeOf.set(t.Team_ID, t.ShortCodeName.toUpperCase());
    }

    const matches = new Map<number, number>();
    const rosters = new Map<number, { home: number; guest: number }>();
    let dropped = 0;
    for (const vm of vsList) {
      const num = vm.MatchNumber == null ? null : String(vm.MatchNumber);
      if (!num) continue;
      const vis = visByNumber.get(num);
      if (!vis) continue;

      // The belt: the two systems must name the same two teams.
      const vsCodes = new Set(
        [vm.HomeTeam_ID, vm.GuestTeam_ID]
          .map((id) => (id == null ? null : shortCodeOf.get(id) ?? null))
          .filter((c): c is string => !!c),
      );
      const visCodes = visCodeByNumber.get(num) ?? new Set<string>();
      const agree =
        vsCodes.size === 2 &&
        visCodes.size === 2 &&
        [...vsCodes].every((c) => visCodes.has(c));
      if (!agree) {
        dropped++;
        continue;
      }
      matches.set(vis.matchNo, vm.ChampionshipMatch_ID);
      if (vm.HomeTeam_ID != null && vm.GuestTeam_ID != null) {
        rosters.set(vm.ChampionshipMatch_ID, {
          home: vm.HomeTeam_ID,
          guest: vm.GuestTeam_ID,
        });
      }
    }
    if (dropped > 0) {
      // Placeholder rows ("TBD v TBD") land here legitimately until a bracket
      // fills in; a large count on a started event is worth a look.
      console.warn(
        `[vs-live] competition ${comp.id}: ${matches.size} matches mapped, ${dropped} dropped (teams did not agree)`,
      );
    }

    ROSTER_CACHE.set(comp.vsChampionshipId, rosterOf);
    return {
      matches,
      championshipId: comp.vsChampionshipId,
      config,
      rosters,
      boardSource: comp.boardSource,
    };
  } catch {
    return null;
  }
}

/** VS championship → (VS Team_ID → shirt number → display name). */
const ROSTER_CACHE = new Map<number, Map<number, Map<number, string>>>();

export function rosterFor(
  championshipId: number,
  teamId: number,
): Map<number, string> | null {
  return ROSTER_CACHE.get(championshipId)?.get(teamId) ?? null;
}

/** Every mapping, rebuilt at most every 10 minutes. */
async function allMappings(now: number = Date.now()): Promise<Map<number, VsMapping>> {
  if (byMatchNo && now - byMatchNoAt < TTL_MS) return byMatchNo;
  return dedupe("vs:mappings", async () => {
    const out = new Map<number, VsMapping>();
    if (!vsConfigured()) {
      byMatchNo = out;
      byMatchNoAt = Date.now();
      return out;
    }
    let comps: LinkedCompetition[] = [];
    try {
      comps = await linkedCompetitions();
    } catch {
      // No database, no mapping — every board stays on VIS, which is correct.
      byMatchNo = out;
      byMatchNoAt = Date.now();
      return out;
    }
    for (const comp of comps) {
      const hit = cache.get(comp.id);
      const mapping =
        hit && Date.now() - hit.at < TTL_MS ? hit.value : await buildMapping(comp);
      cache.set(comp.id, { value: mapping, at: Date.now() });
      if (!mapping) continue;
      for (const matchNo of mapping.matches.keys()) out.set(matchNo, mapping);
    }
    byMatchNo = out;
    byMatchNoAt = Date.now();
    return out;
  });
}

export interface VsTarget {
  championshipMatchId: number;
  mapping: VsMapping;
}

/** The VolleyStation match behind a VIS match number, or null. */
export async function vsTargetFor(matchNo: number): Promise<VsTarget | null> {
  const all = await allMappings();
  const mapping = all.get(matchNo);
  const id = mapping?.matches.get(matchNo);
  return mapping && id != null ? { championshipMatchId: id, mapping } : null;
}

/**
 * Which source should serve this match, given the competition's setting and an
 * optional per-screen override.
 *
 * `auto` and `vs` both mean "VolleyStation when we can": the difference is
 * intent rather than behaviour today, and keeping them distinct lets `vs` grow
 * a louder failure mode later without re-migrating.
 */
export async function sourceFor(
  matchNo: number,
  requested?: BoardSource | null,
): Promise<{ source: BoardSource; target: VsTarget | null }> {
  const target = await vsTargetFor(matchNo).catch(() => null);
  if (requested === "vis") return { source: "vis", target: null };
  if (requested === "vs") return { source: target ? "vs" : "vis", target };
  const wants = target?.mapping.boardSource ?? "vis";
  const useVs = target != null && (wants === "vs" || wants === "auto");
  return { source: useVs ? "vs" : "vis", target: useVs ? target : null };
}

/** Test seam. */
export function __resetVsResolve(): void {
  cache.clear();
  byMatchNo = null;
  byMatchNoAt = 0;
  inFlight.clear();
  ROSTER_CACHE.clear();
}
