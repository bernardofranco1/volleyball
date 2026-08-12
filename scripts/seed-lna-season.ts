// Seed a complete past LNA season (Swiss women's Ligue A) for VBC Cheseaux.
//
//   npx tsx --env-file=.env.local scripts/seed-lna-season.ts            # dry run
//   npx tsx --env-file=.env.local scripts/seed-lna-season.ts --execute
//
// Unlike the demo seed — which shortcuts finished matches to a declared SET_END
// with no rallies — every match here is PLAYED THROUGH THE ENGINE rally by
// rally: coin toss, both lineups, RALLY_START before each point, time-outs,
// substitutions, libero replacements, auto-emitted TTOs / SET_END / MATCH_END.
// That is the point of this data: the official e-scoresheet is rendered from
// the event log, so only a complete log exercises the service ladders, the
// substitution and time-out boxes and the results block.
//
// Deterministic: a fixed PRNG seed means re-running produces the same season.
// Idempotent: wipes this tenant's competitions first (FK-safe), then rebuilds.
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  competitions,
  events,
  interruptRequests,
  matchOfficials,
  matchSessions,
  matchSignatures,
  matches,
  people,
  personRoles,
  players,
  poolTeams,
  pools,
  teams,
  tenants,
  tournamentConfig,
} from "../src/db/schema";
import { getEngine } from "../src/engine/registry";
import type { TournamentConfig } from "../src/engine/config";
import type { IndoorMatchState } from "../src/engine/indoor/types";
import { newId } from "../src/lib/id";
import { resultDigest } from "../src/lib/match-signatures";
import { placeholderEmail } from "../src/lib/people-domain";

const TENANT_SLUG = "vbc-cheseaux";
const COMPETITION_ID = "comp_lna_2526";
const SEASON_LABEL = "LNA Féminine 2025-26";
const execute = process.argv.includes("--execute");

// ── deterministic RNG ────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20252026);
const chance = (p: number) => rng() < p;

// ── the league ───────────────────────────────────────────────────────────────
// Eight clubs of the Swiss women's top flight; VBC Cheseaux is the tenant's own.
// Rosters are fictional players with plausible Swiss / import names — this is
// demo data, not a real registry.
interface ClubSpec {
  name: string;
  short: string; // 3-letter code printed on the scoresheet
  city: string;
  hall: string;
  strength: number; // 0..1, drives rally win probability
  players: [string, string][]; // [firstName, lastName]
}

const CLUBS: ClubSpec[] = [
  {
    name: "VBC Cheseaux", short: "CHE", city: "Cheseaux-sur-Lausanne",
    hall: "Salle omnisports de Cheseaux", strength: 0.53,
    players: [
      ["Léa", "Rochat"], ["Marine", "Dubois"], ["Sofia", "Ferrari"], ["Elodie", "Perrin"],
      ["Chiara", "Bettini"], ["Naomi", "Berger"], ["Jade", "Monnier"], ["Anouk", "Favre"],
      ["Line", "Progin"], ["Zoé", "Kohler"], ["Alina", "Novak"], ["Maya", "Grandjean"],
      ["Coralie", "Blanc"], ["Nina", "Steiner"],
    ],
  },
  {
    name: "Sm'Aesch Pfeffingen", short: "AES", city: "Aesch", hall: "Löhrenacker",
    strength: 0.60,
    players: [
      ["Madlaina", "Matter"], ["Tanja", "Bühler"], ["Ana", "Marković"], ["Selina", "Wyss"],
      ["Laura", "Künzler"], ["Emma", "Vogt"], ["Fiona", "Schmid"], ["Nadia", "Frei"],
      ["Julia", "Hofer"], ["Kim", "Brunner"], ["Sara", "Baumann"], ["Lena", "Roth"],
      ["Melina", "Suter"], ["Anja", "Weber"],
    ],
  },
  {
    name: "Viteos NUC", short: "NUC", city: "Neuchâtel", hall: "Riveraine",
    strength: 0.62,
    players: [
      ["Camille", "Jaquet"], ["Océane", "Girard"], ["Ivana", "Petrović"], ["Sarah", "Mercier"],
      ["Lucie", "Baumgartner"], ["Alice", "Renaud"], ["Manon", "Gerber"], ["Eva", "Fischer"],
      ["Clara", "Marti"], ["Noémie", "Aebi"], ["Tessa", "Lehmann"], ["Julie", "Chapuis"],
      ["Amélie", "Roux"], ["Livia", "Keller"],
    ],
  },
  {
    name: "TS Volley Düdingen", short: "DUD", city: "Düdingen", hall: "Leimacker",
    strength: 0.57,
    players: [
      ["Andrea", "Riedo"], ["Simone", "Zbinden"], ["Petra", "Novotná"], ["Ines", "Aeby"],
      ["Nathalie", "Jungo"], ["Karin", "Schaller"], ["Belinda", "Cotting"], ["Rahel", "Stucki"],
      ["Vanessa", "Bapst"], ["Sandra", "Piller"], ["Milena", "Horvat"], ["Fabienne", "Wider"],
      ["Céline", "Aebischer"], ["Tamara", "Egger"],
    ],
  },
  {
    name: "Volley Toggenburg", short: "TOG", city: "Wattwil", hall: "Rietsteg",
    strength: 0.48,
    players: [
      ["Michelle", "Grob"], ["Ramona", "Gähler"], ["Katja", "Bösch"], ["Seline", "Rüegg"],
      ["Deborah", "Looser"], ["Jasmin", "Scherrer"], ["Aline", "Bollhalder"], ["Nadine", "Egli"],
      ["Sina", "Hollenstein"], ["Corinne", "Widmer"], ["Dora", "Kovács"], ["Lorena", "Bühler"],
      ["Steffi", "Rutz"], ["Yvonne", "Koller"],
    ],
  },
  {
    name: "VC Kanti Schaffhausen", short: "KAN", city: "Schaffhausen", hall: "Kantonsschule",
    strength: 0.50,
    players: [
      ["Lara", "Meister"], ["Fiona", "Bührer"], ["Marta", "Sikora"], ["Janine", "Stamm"],
      ["Rebecca", "Winzeler"], ["Sabrina", "Hug"], ["Chantal", "Meier"], ["Noelle", "Bächtold"],
      ["Vera", "Rahm"], ["Sonja", "Uhlmann"], ["Ida", "Larsen"], ["Michèle", "Bolli"],
      ["Katrin", "Spahn"], ["Elin", "Furrer"],
    ],
  },
  {
    name: "Genève Volley", short: "GEN", city: "Genève", hall: "Le Bout-du-Monde",
    strength: 0.55,
    players: [
      ["Charlotte", "Dupraz"], ["Inès", "Moret"], ["Daniela", "Costa"], ["Aurélie", "Pittet"],
      ["Salomé", "Barras"], ["Margaux", "Rey"], ["Lisa", "Fontana"], ["Emilie", "Currat"],
      ["Anaïs", "Deville"], ["Yara", "Haddad"], ["Roberta", "Silva"], ["Chloé", "Besson"],
      ["Fanny", "Terrier"], ["Leana", "Corminboeuf"],
    ],
  },
  {
    name: "VFM Franches-Montagnes", short: "VFM", city: "Saignelégier",
    hall: "Halle du Chaux-d'Abel", strength: 0.45,
    players: [
      ["Justine", "Boillat"], ["Elise", "Froidevaux"], ["Marina", "Beuret"], ["Sophie", "Cattin"],
      ["Laetitia", "Willemin"], ["Morgane", "Queloz"], ["Estelle", "Jobin"], ["Lucie", "Gogniat"],
      ["Alexia", "Donzé"], ["Katia", "Erard"], ["Nora", "Aubry"], ["Valérie", "Chapatte"],
      ["Sibylle", "Farine"], ["Delphine", "Girardin"],
    ],
  },
];

const REFEREES: [string, string, string][] = [
  ["Marc", "Bezençon", "National A"], ["Ursula", "Stettler", "National A"],
  ["Jean-Pierre", "Follonier", "National A"], ["Silvia", "Zanetti", "National B"],
  ["Thomas", "Lüthi", "National A"], ["Corinne", "Délèze", "National B"],
  ["Andreas", "Wenger", "National A"], ["Nathalie", "Python", "National B"],
];
const SCORERS: [string, string][] = [
  ["Pierre", "Magnin"], ["Isabelle", "Cornut"], ["Daniel", "Roulin"], ["Sylvie", "Baudat"],
];

// ── model helpers ────────────────────────────────────────────────────────────
interface BuiltTeam {
  id: string;
  club: ClubSpec;
  /** playerIds in roster order (0-5 starters, 6 = libero, 7 = 2nd libero). */
  playerIds: string[];
  liberoId: string;
  secondLiberoId: string;
}

type Payload = { type: string } & Record<string, unknown>;

function isoAt(day: string, hour: number, minute = 0): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

// ── wipe (FK-safe), mirroring demo-seed's order ──────────────────────────────
async function wipeTenant(tenantId: string) {
  const comps = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.tenantId, tenantId));
  for (const c of comps) {
    const ms = await db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.competitionId, c.id));
    const matchIds = ms.map((m) => m.id);
    if (matchIds.length) {
      await db.delete(events).where(inArray(events.matchId, matchIds));
      await db.delete(matchSessions).where(inArray(matchSessions.matchId, matchIds));
      await db.delete(interruptRequests).where(inArray(interruptRequests.matchId, matchIds));
      await db.delete(matchSignatures).where(inArray(matchSignatures.matchId, matchIds));
      await db.delete(matchOfficials).where(inArray(matchOfficials.matchId, matchIds));
    }
    await db.delete(matches).where(eq(matches.competitionId, c.id));
    const ts = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.competitionId, c.id));
    const teamIds = ts.map((t) => t.id);
    if (teamIds.length) {
      await db.delete(players).where(inArray(players.teamId, teamIds));
      await db.delete(poolTeams).where(inArray(poolTeams.teamId, teamIds));
    }
    await db.delete(pools).where(eq(pools.competitionId, c.id));
    await db.delete(teams).where(eq(teams.competitionId, c.id));
    await db.delete(tournamentConfig).where(eq(tournamentConfig.competitionId, c.id));
    await db.delete(competitions).where(eq(competitions.id, c.id));
  }
  const ppl = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.tenantId, tenantId));
  const personIds = ppl.map((p) => p.id);
  if (personIds.length) {
    await db.delete(personRoles).where(inArray(personRoles.personId, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
}

async function buildTeam(
  tenantId: string,
  competitionId: string,
  club: ClubSpec,
  seed: number,
): Promise<BuiltTeam> {
  const teamId = newId("team");
  await db.insert(teams).values({
    id: teamId,
    competitionId,
    tenantId,
    displayName: club.name,
    clubName: club.name,
    // No country code: this is a DOMESTIC league, so the sheet's TEAM box must
    // identify the club. teamCode() prefers countryCode when set, which would
    // print "SUI" for both sides and make the set panels indistinguishable.
    countryCode: null,
    seed,
  });

  const playerIds: string[] = [];
  // 14 players: 0-5 starting six, 6-7 liberos, 8-13 bench.
  for (const [i, [firstName, lastName]] of club.players.entries()) {
    const personId = newId("per");
    const isLibero = i === 6 || i === 7;
    await db.insert(people).values({
      id: personId,
      tenantId,
      firstName,
      lastName,
      jerseyName: lastName,
      gender: "W",
      email: placeholderEmail(personId),
    });
    await db.insert(personRoles).values({
      id: newId("prl"),
      personId,
      tenantId,
      role: "PLAYER",
    });
    const playerId = newId("plr");
    await db.insert(players).values({
      id: playerId,
      teamId,
      tenantId,
      personId,
      jerseyNumber: i + 1,
      isCaptain: i === 0,
      isLibero,
      role: i < 8 ? "PLAYER" : "BENCH",
    });
    playerIds.push(playerId);
  }
  return { id: teamId, club, playerIds, liberoId: playerIds[6], secondLiberoId: playerIds[7] };
}

// ── the engine driver ────────────────────────────────────────────────────────
const SYSTEM_EVENTS = new Set(["SET_END", "MATCH_END", "SIDE_SWITCH", "TTO_START"]);
const engine = getEngine("INDOOR");
if (!engine) throw new Error("indoor engine missing");

// The registry hands back the discipline-agnostic CommonMatchState; this
// script is indoor-only and drives set-level detail, so it reads the concrete
// shape (same boundary cast the app's indoor callers use).
type IndoorState = IndoorMatchState;

interface PlayPlan {
  /** FULL = play to the final whistle; LIVE = stop mid-set. */
  kind: "FULL" | "LIVE";
  /** LIVE only: how many complete sets before stopping. */
  completedSets?: number;
  /** LIVE only: rallies into the unfinished set. */
  pointsIn?: number;
}

interface PlayResult {
  rows: (typeof events.$inferInsert)[];
  state: IndoorState;
}

/**
 * Play one match through the real engine, emitting a complete action log.
 * Anything the engine refuses throws — a silently skipped payload is exactly
 * the hole that leaves an e-scoresheet half-empty.
 */
function playMatch(
  matchId: string,
  tenantId: string,
  cfg: TournamentConfig,
  home: BuiltTeam,
  away: BuiltTeam,
  startAt: Date,
  plan: PlayPlan,
): PlayResult {
  const eng = engine!;
  let state = eng.replay(matchId, [], cfg) as unknown as IndoorState;
  const collected: { id: string; sequence: number; timestamp: string; payload: Payload }[] = [];
  let seq = 0;
  let clock = startAt.getTime();

  const tick = (ms: number) => {
    clock += ms;
    return new Date(clock).toISOString();
  };

  function push(payload: Payload, ms = 0, optional = false): boolean {
    const res = eng.append(state as never, payload as never, cfg, {
      nextSequence: seq + 1,
      timestamp: tick(ms),
      makeId: () => newId("evt"),
    });
    if (!res.ok) {
      if (optional) return false;
      throw new Error(`[${matchId}] ${payload.type} rejected: ${res.reason}`);
    }
    for (const e of res.newEvents)
      collected.push(e as { id: string; sequence: number; timestamp: string; payload: Payload });
    state = res.state as unknown as IndoorState;
    seq = state.lastSequence;
    // (Indoor has no technical time-outs under the current rules — no
    // TTO_ACTIVE phase to close, unlike beach.)
    return true;
  }

  const lineupFor = (t: BuiltTeam, team: "A" | "B", setNumber: number): Payload => ({
    type: "LINEUP_CONFIRMED",
    team,
    setNumber,
    playerIds: t.playerIds.slice(0, 6),
    liberoId: t.liberoId,
    secondLiberoId: t.secondLiberoId,
  });

  // ── pre-match ──────────────────────────────────────────────────────────────
  const tossWinner: "A" | "B" = chance(0.5) ? "A" : "B";
  const firstServer: "A" | "B" = chance(0.55) ? tossWinner : tossWinner === "A" ? "B" : "A";
  push({ type: "MATCH_CREATED", matchId });
  push({ type: "COIN_TOSS", firstServer, teamAStartSide: "LEFT", tossWinner }, 60_000);
  push(lineupFor(home, "A", 1), 30_000);
  push(lineupFor(away, "B", 1), 15_000);
  push({ type: "MATCH_START" }, 120_000);

  // ── sets ───────────────────────────────────────────────────────────────────
  const strengthA = home.club.strength;
  const strengthB = away.club.strength;
  let setNumber = 1;
  let server = firstServer;
  let teamASide: "LEFT" | "RIGHT" = "LEFT";
  let completed = 0;

  while (setNumber <= (cfg.bestOf ?? 5)) {
    push(
      { type: "SET_START", setNumber, firstServer: server, teamAStartSide: teamASide },
      setNumber === 1 ? 30_000 : 180_000,
    );
    // Sets 2+ need their lineups; SET_START consumes the stashed ones for set 1.
    if (state.rallyPhase === "LINEUP_PENDING") {
      push(lineupFor(home, "A", setNumber), 5_000);
      push(lineupFor(away, "B", setNumber), 5_000);
    }

    const target = setNumber === (cfg.bestOf ?? 5) ? (cfg.setScoreTiebreak ?? 15) : (cfg.setScore ?? 25);
    let toA = 0;
    let toB = 0;
    let subsA = 0;
    let subsB = 0;
    let rallies = 0;
    const isLastLiveSet = plan.kind === "LIVE" && completed === (plan.completedSets ?? 0);

    for (;;) {
      const set = state.sets[state.sets.length - 1];
      if (!set || set.winner) break;
      if (isLastLiveSet && rallies >= (plan.pointsIn ?? 12)) break;

      const { scoreA, scoreB } = set;

      // Time-outs: a coach stops the run when clearly behind (max 2 per set).
      const behindA = scoreB - scoreA;
      if (behindA >= 4 && toA < 2 && chance(0.45)) {
        push({ type: "TIMEOUT_REQUEST", team: "A" }, 8_000);
        push({ type: "TIMEOUT_END", team: "A" }, 30_000);
        toA++;
      } else if (-behindA >= 4 && toB < 2 && chance(0.45)) {
        push({ type: "TIMEOUT_REQUEST", team: "B" }, 8_000);
        push({ type: "TIMEOUT_END", team: "B" }, 30_000);
        toB++;
      }

      // Substitutions: bench players 9-12 come on for a starter.
      if (scoreA + scoreB >= 12 && subsA < 2 && chance(0.18)) {
        const onCourt = state.sets[state.sets.length - 1].courtPositionsA;
        const out = onCourt[Math.floor(rng() * onCourt.length)];
        const inP = home.playerIds[8 + subsA];
        if (out && inP && push({ type: "SUBSTITUTION", team: "A", outPlayerId: out, inPlayerId: inP }, 20_000, true))
          subsA++;
      }
      if (scoreA + scoreB >= 12 && subsB < 2 && chance(0.18)) {
        const onCourt = state.sets[state.sets.length - 1].courtPositionsB;
        const out = onCourt[Math.floor(rng() * onCourt.length)];
        const inP = away.playerIds[8 + subsB];
        if (out && inP && push({ type: "SUBSTITUTION", team: "B", outPlayerId: out, inPlayerId: inP }, 20_000, true))
          subsB++;
      }

      // The rally itself: an explicit start (real service timestamp) then the point.
      push({ type: "RALLY_START" }, 12_000);
      // Serving team gets a small edge; a trailing team late in the set fights back.
      const base = strengthA / (strengthA + strengthB);
      const serveBonus = server === "A" ? 0.04 : -0.04;
      const clutch = scoreA >= target - 3 || scoreB >= target - 3 ? 0.5 : 1;
      const pA = Math.min(0.85, Math.max(0.15, 0.5 + (base - 0.5 + serveBonus) * clutch * 2));
      const aWins = chance(pA);
      push({ type: aWins ? "RALLY_WON_A" : "RALLY_WON_B" }, 18_000 + Math.floor(rng() * 22_000));
      server = aWins ? "A" : "B";
      rallies++;
      if (rallies > 400) throw new Error(`[${matchId}] runaway set`);
    }

    const finished = state.sets[state.sets.length - 1]?.winner != null;
    if (!finished) break; // LIVE match parked mid-set
    completed++;
    if (state.status === "FINISHED") break;
    if (plan.kind === "LIVE" && completed >= (plan.completedSets ?? 0) && (plan.pointsIn ?? 0) === 0)
      break;
    setNumber++;
    teamASide = teamASide === "LEFT" ? "RIGHT" : "LEFT";
  }

  // ── denormalised rows ──────────────────────────────────────────────────────
  let snap = eng.replay(matchId, [], cfg) as unknown as IndoorState;
  const rows = collected.map((e) => {
    snap = eng.reduce(snap as never, e as never, cfg) as unknown as IndoorState;
    const d = eng.denormalize(snap as never);
    return {
      id: e.id,
      matchId,
      tenantId,
      sequence: e.sequence,
      timestamp: new Date(e.timestamp),
      eventType: e.payload.type,
      payload: e.payload,
      actor: (SYSTEM_EVENTS.has(e.payload.type) ? "SYSTEM" : "SCORER") as "SYSTEM" | "SCORER",
      ...d,
    } as typeof events.$inferInsert;
  });

  return { rows, state };
}

// ── signatures ───────────────────────────────────────────────────────────────
/** A plausible hand-drawn scribble in the pad's unit square (x,y ∈ 0..1). */
function scribble(): { pad: { w: number; h: number }; strokes: number[][][] } {
  const strokes: number[][][] = [];
  const count = 1 + Math.floor(rng() * 2);
  for (let s = 0; s < count; s++) {
    const pts: number[][] = [];
    const n = 12 + Math.floor(rng() * 10);
    let x = 0.08 + rng() * 0.1 + s * 0.35;
    let y = 0.55 + rng() * 0.15;
    for (let i = 0; i < n; i++) {
      x += 0.02 + rng() * 0.03;
      y += (rng() - 0.5) * 0.28;
      pts.push([Math.min(0.97, x), Math.min(0.95, Math.max(0.05, y))]);
    }
    strokes.push(pts);
  }
  return { pad: { w: 1, h: 0.32 }, strokes };
}

async function signMatch(
  matchId: string,
  tenantId: string,
  digest: string,
  sequence: number,
  when: Date,
  home: BuiltTeam,
  away: BuiltTeam,
  refereeName: string,
) {
  const captainA = `${home.club.players[0][1]} ${home.club.players[0][0][0]}.`;
  const captainB = `${away.club.players[0][1]} ${away.club.players[0][0][0]}.`;
  const rows = [
    // Pre-match: captains attest to the roster before the first serve. These
    // never gate confirmation and never go stale (spec/21 Phase D).
    ["TEAM_A_CAPTAIN_PREMATCH", captainA, home.playerIds[0]],
    ["TEAM_B_CAPTAIN_PREMATCH", captainB, away.playerIds[0]],
    // The confirmation trio (spec/20) — the third of these finalises the result.
    ["TEAM_A_CAPTAIN", captainA, home.playerIds[0]],
    ["TEAM_B_CAPTAIN", captainB, away.playerIds[0]],
    ["FIRST_REFEREE", refereeName, null],
  ] as const;
  for (const [role, signerName, playerId] of rows) {
    await db.insert(matchSignatures).values({
      id: newId("sig"),
      matchId,
      tenantId,
      role: role as (typeof rows)[number][0],
      signerName,
      signerPlayerId: playerId,
      strokes: scribble(),
      intent: "ACCEPT",
      signedAt: when,
      signedSequence: sequence,
      resultDigest: digest,
    });
  }
}

// ── schedule ─────────────────────────────────────────────────────────────────
/** Circle-method single round robin: 7 rounds × 4 matches for 8 teams. */
function roundRobin(n: number): [number, number][][] {
  const idx = [...Array(n).keys()];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = idx[i];
      const b = idx[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    idx.splice(1, 0, idx.pop() as number); // rotate all but the first
  }
  return rounds;
}

// Saturday match days across a real Swiss season (Oct 2025 → Mar 2026).
const MATCH_DAYS = [
  "2025-10-11", "2025-10-25", "2025-11-15", "2025-11-29",
  "2025-12-13", "2026-01-17", "2026-02-07",
];

async function main() {
  const tenant = (
    await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, TENANT_SLUG))
      .limit(1)
  )[0];
  if (!tenant) throw new Error(`tenant '${TENANT_SLUG}' not found — provision it first`);

  const rounds = roundRobin(CLUBS.length);
  const total = rounds.flat().length;
  const liveFrom = total - 6;
  const scheduledFrom = total - 3;

  console.log(execute ? "APPLYING" : "DRY RUN (pass --execute to apply)");
  console.log(`  tenant:      ${tenant.name} (${tenant.id})`);
  console.log(`  competition: ${SEASON_LABEL} — INDOOR / WOMEN, best of 5`);
  console.log(`  teams:       ${CLUBS.length} (${CLUBS.map((c) => c.short).join(", ")})`);
  console.log(`  matches:     ${total} → ${liveFrom} finished, 3 live, 3 scheduled`);
  console.log(`  logs:        full rally-by-rally through the engine`);
  if (!execute) return;

  await wipeTenant(tenant.id);

  await db.insert(competitions).values({
    id: COMPETITION_ID,
    tenantId: tenant.id,
    name: SEASON_LABEL,
    discipline: "INDOOR",
    gender: "WOMEN",
    startDate: MATCH_DAYS[0],
    endDate: MATCH_DAYS[MATCH_DAYS.length - 1],
    venue: "Various",
    city: "Cheseaux-sur-Lausanne",
    country: "Switzerland",
    category: "SENIOR",
    status: "ACTIVE",
  });
  await db.insert(tournamentConfig).values({
    competitionId: COMPETITION_ID,
    bestOf: 5,
    vcsEnabled: true,
    teamTabletEnabled: true,
  });

  const built: BuiltTeam[] = [];
  for (const [i, club] of CLUBS.entries()) {
    built.push(await buildTeam(tenant.id, COMPETITION_ID, club, i + 1));
  }
  console.log(`✓ ${built.length} teams, ${built.length * 14} players`);

  const cfg: TournamentConfig = {
    ...((await import("../src/engine/config")).resolveConfig("INDOOR", {
      bestOf: 5,
      vcsEnabled: true,
      teamTabletEnabled: true,
    })),
  };

  let n = 0;
  let signedCount = 0;
  let finishedCount = 0;
  let liveCount = 0;
  let scheduledCount = 0;

  for (const [roundIdx, pairs] of rounds.entries()) {
    const day = MATCH_DAYS[roundIdx];
    for (const [hi, ai] of pairs) {
      const home = built[hi];
      const away = built[ai];
      const matchNumber = n + 1;
      const hour = 17 + (n % 3); // 17:00 / 18:00 / 19:00 throws
      const scheduledAt = isoAt(day, hour);
      const matchId = newId("match");

      const status: "FINISHED" | "LIVE" | "SCHEDULED" =
        n < liveFrom ? "FINISHED" : n < scheduledFrom ? "LIVE" : "SCHEDULED";

      await db.insert(matches).values({
        id: matchId,
        competitionId: COMPETITION_ID,
        tenantId: tenant.id,
        teamAId: home.id,
        teamBId: away.id,
        discipline: "INDOOR",
        status: "SCHEDULED",
        roundName: `Round ${roundIdx + 1}`,
        matchNumber,
        courtNumber: 1,
        scheduledAt,
      });

      if (status !== "SCHEDULED") {
        const plan: PlayPlan =
          status === "FINISHED"
            ? { kind: "FULL" }
            : { kind: "LIVE", completedSets: 1 + (n % 2), pointsIn: 9 + ((n * 7) % 12) };
        const { rows, state } = playMatch(
          matchId,
          tenant.id,
          cfg,
          home,
          away,
          scheduledAt,
          plan,
        );
        if (rows.length) await db.insert(events).values(rows);
        await db
          .update(matches)
          .set({
            setsWonA: state.setsWonA,
            setsWonB: state.setsWonB,
            winner: state.winner,
            status: engine!.matchStatusOf(state as never),
            startedAt: state.matchStartedAt ? new Date(state.matchStartedAt) : null,
            finishedAt:
              state.status === "FINISHED"
                ? new Date(rows[rows.length - 1].timestamp as Date)
                : null,
            ...(state.status === "FINISHED"
              ? {
                  confirmedAt: new Date(rows[rows.length - 1].timestamp as Date),
                  // Most sheets are signed at the table; every 6th stays
                  // admin-confirmed so both confirmation paths exist to test
                  // (and so a few finished matches remain unlocked for rewind).
                  confirmedVia: (n % 6 === 5 ? "ADMIN" : "SIGNATURES") as
                    | "ADMIN"
                    | "SIGNATURES",
                }
              : {}),
          })
          .where(eq(matches.id, matchId));

        // Officials — the sheet's APPROVAL block prints these.
        const refA = REFEREES[n % REFEREES.length];
        const refB = REFEREES[(n + 3) % REFEREES.length];
        const sc = SCORERS[n % SCORERS.length];
        const officialPeople: [string, [string, string], string | null][] = [
          ["FIRST_REFEREE", [refA[0], refA[1]], refA[2]],
          ["SECOND_REFEREE", [refB[0], refB[1]], refB[2]],
          ["SCORER", sc, null],
        ];
        for (const [role, [firstName, lastName], level] of officialPeople) {
          const personId = newId("per");
          await db.insert(people).values({
            id: personId,
            tenantId: tenant.id,
            firstName,
            lastName,
            jerseyName: lastName,
            email: placeholderEmail(personId),
          });
          await db.insert(personRoles).values({
            id: newId("prl"),
            personId,
            tenantId: tenant.id,
            role: role === "SCORER" ? "SCORER" : "REFEREE",
          });
          await db.insert(matchOfficials).values({
            id: newId("off"),
            matchId,
            tenantId: tenant.id,
            role: role as "FIRST_REFEREE" | "SECOND_REFEREE" | "SCORER",
            personId,
            name: `${lastName} ${firstName[0]}.`,
            country: "SUI",
            level,
          });
        }

        if (status === "FINISHED" && n % 6 !== 5) {
          await signMatch(
            matchId,
            tenant.id,
            resultDigest(state as never),
            state.lastSequence,
            new Date(rows[rows.length - 1].timestamp as Date),
            home,
            away,
            `${refA[1]} ${refA[0][0]}.`,
          );
          signedCount++;
        }

        if (status === "FINISHED") finishedCount++;
        else liveCount++;
        const s = state.sets
          .map((x: { scoreA: number; scoreB: number }) => `${x.scoreA}-${x.scoreB}`)
          .join(" ");
        console.log(
          `  ${status.padEnd(9)} R${roundIdx + 1} ${home.club.short}-${away.club.short}  ${s}  (${rows.length} events)`,
        );
      } else {
        scheduledCount++;
        console.log(`  SCHEDULED R${roundIdx + 1} ${home.club.short}-${away.club.short}  ${day} ${hour}:00`);
      }
      n++;
    }
  }

  console.log(
    `\n✓ ${SEASON_LABEL}: ${finishedCount} finished (${signedCount} with signed scoresheets), ` +
      `${liveCount} live, ${scheduledCount} scheduled`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
