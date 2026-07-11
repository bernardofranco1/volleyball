// Reusable demo seed (spec/13) — shared by the CLI script (src/scripts/seed.ts)
// and the daily cron route (src/app/api/cron/reseed/route.ts).
//
// Wipes EVERY competition under the demo tenant (FK-safe) and rebuilds four —
// one per discipline — each with a finished match and a live (mid-match) match.
// Matches are produced through the real engine so events + denormalised columns
// are correct by construction.
//
// Competition names carry the day+month (e.g. "Indoor Lausanne 1107") and all
// dates/timestamps use the run date, so a daily run keeps the database active
// while presenting fresh, dated demo content.
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  competitionBranding,
  competitions,
  events,
  interruptRequests,
  matchSessions,
  matches,
  players,
  pools,
  poolTeams,
  teams,
  tenantBranding,
  tenants,
  tournamentConfig,
} from "@/db/schema";
import { resolveMatchConfig } from "@/lib/match-engine";
import { getEngine } from "@/engine/registry";
import type { TournamentConfig } from "@/engine/config";
import type { Discipline, TeamId, CourtSide } from "@/engine/types";
import { newId } from "@/lib/id";

const TENANT = { id: "tenant_fivb_demo", slug: "fivb-demo", name: "FIVB Demo" };

type Payload = { type: string } & Record<string, unknown>;

interface PlayerSpec {
  firstName: string;
  lastName: string;
  jerseyNumber: number;
  isCaptain?: boolean;
  isLibero?: boolean;
  bench?: boolean;
}
interface TeamSpec {
  displayName: string;
  seed: number;
  clubName?: string;
  players: PlayerSpec[];
}
interface CreatedTeam {
  id: string;
  starters: string[]; // non-bench, non-libero playerIds in order
  libero: string | null;
}

// ── run-date context (set at the start of runDemoSeed) ───────────────────────
let SEED_TS = "2026-07-01T10:00:00.000Z";
let DATE_TAG = "0107"; // DDMM
let TODAY = "2026-07-01"; // YYYY-MM-DD (UTC)

/** "Indoor Lausanne 1107" — discipline + venue city + DDMM. */
function compName(label: string): string {
  return `${label} ${DATE_TAG}`;
}

async function ensureTenant() {
  await db
    .insert(tenants)
    .values({ id: TENANT.id, slug: TENANT.slug, name: TENANT.name })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: TENANT.name } });
  await db
    .insert(tenantBranding)
    .values({ tenantId: TENANT.id, primaryColor: "#0047AB", secondaryColor: "#FFD700" })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: { primaryColor: "#0047AB", secondaryColor: "#FFD700" },
    });
}

async function wipeCompetition(compId: string) {
  const ms = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.competitionId, compId));
  const matchIds = ms.map((m) => m.id);
  if (matchIds.length) {
    await db.delete(events).where(inArray(events.matchId, matchIds));
    await db.delete(matchSessions).where(inArray(matchSessions.matchId, matchIds));
    await db
      .delete(interruptRequests)
      .where(inArray(interruptRequests.matchId, matchIds));
  }
  await db.delete(matches).where(eq(matches.competitionId, compId));

  const ts = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.competitionId, compId));
  const teamIds = ts.map((t) => t.id);
  if (teamIds.length) {
    await db.delete(players).where(inArray(players.teamId, teamIds));
    await db.delete(poolTeams).where(inArray(poolTeams.teamId, teamIds));
  }
  await db.delete(pools).where(eq(pools.competitionId, compId));
  await db.delete(teams).where(eq(teams.competitionId, compId));
  await db.delete(tournamentConfig).where(eq(tournamentConfig.competitionId, compId));
  await db
    .delete(competitionBranding)
    .where(eq(competitionBranding.competitionId, compId));
  await db.delete(competitions).where(eq(competitions.id, compId));
}

/** Delete EVERY competition currently under the demo tenant (daily reset). */
async function wipeAllForTenant() {
  const comps = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.tenantId, TENANT.id));
  for (const c of comps) await wipeCompetition(c.id);
}

async function createTeam(compId: string, spec: TeamSpec): Promise<CreatedTeam> {
  const id = newId("team");
  await db.insert(teams).values({
    id,
    competitionId: compId,
    tenantId: TENANT.id,
    displayName: spec.displayName,
    seed: spec.seed,
    clubName: spec.clubName ?? null,
  });
  const rows = spec.players.map((p) => ({
    id: newId("plyr"),
    teamId: id,
    tenantId: TENANT.id,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: `${p.firstName} ${p.lastName}`,
    jerseyNumber: p.jerseyNumber,
    isCaptain: p.isCaptain ?? false,
    isLibero: p.isLibero ?? false,
    role: (p.bench ? "BENCH" : "PLAYER") as "PLAYER" | "BENCH" | "STAFF",
  }));
  await db.insert(players).values(rows);
  return {
    id,
    starters: rows.filter((r) => !r.isLibero && r.role === "PLAYER").map((r) => r.id),
    libero: rows.find((r) => r.isLibero)?.id ?? null,
  };
}

async function createMatch(
  compId: string,
  discipline: Discipline,
  a: string,
  b: string,
  matchNumber: number,
  roundName: string,
): Promise<string> {
  const id = newId("match");
  await db.insert(matches).values({
    id,
    competitionId: compId,
    tenantId: TENANT.id,
    teamAId: a,
    teamBId: b,
    discipline,
    status: "SCHEDULED",
    roundName,
    matchNumber,
  });
  return id;
}

/** Rally payloads to reach exactly (a, b): loser's points first, then winner's. */
function rallyPayloads(a: number, b: number): Payload[] {
  const aWins = a >= b;
  const loser: Payload = aWins ? { type: "RALLY_WON_B" } : { type: "RALLY_WON_A" };
  const winner: Payload = aWins ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" };
  const out: Payload[] = [];
  for (let i = 0; i < (aWins ? b : a); i++) out.push(loser);
  for (let i = 0; i < (aWins ? a : b); i++) out.push(winner);
  return out;
}

function lineupEventsBoth(
  discipline: Discipline,
  setNumber: number,
  A: CreatedTeam,
  B: CreatedTeam,
  n: number,
): Payload[] {
  if (discipline === "INDOOR") {
    return [
      {
        type: "LINEUP_CONFIRMED",
        team: "A",
        setNumber,
        playerIds: A.starters.slice(0, n),
        liberoId: A.libero,
        secondLiberoId: null,
      },
      {
        type: "LINEUP_CONFIRMED",
        team: "B",
        setNumber,
        playerIds: B.starters.slice(0, n),
        liberoId: B.libero,
        secondLiberoId: null,
      },
    ];
  }
  // GRASS / LIGHT: one event for both teams.
  return [
    {
      type: "LINEUP_CONFIRMED",
      setNumber,
      teamAPlayerIds: A.starters.slice(0, n),
      teamBPlayerIds: B.starters.slice(0, n),
    },
  ];
}

function setStartPayloads(
  discipline: Discipline,
  setNumber: number,
  firstServer: TeamId,
  side: CourtSide,
  A: CreatedTeam,
  B: CreatedTeam,
  n: number,
  confirmLineup: boolean,
): Payload[] {
  const out: Payload[] = [
    { type: "SET_START", setNumber, firstServer, teamAStartSide: side },
  ];
  if (discipline !== "BEACH" && confirmLineup) {
    out.push(...lineupEventsBoth(discipline, setNumber, A, B, n));
  }
  return out;
}

const other = (t: TeamId): TeamId => (t === "A" ? "B" : "A");
const flip = (s: CourtSide): CourtSide => (s === "LEFT" ? "RIGHT" : "LEFT");

function buildPayloads(
  discipline: Discipline,
  A: CreatedTeam,
  B: CreatedTeam,
  n: number,
  sets: [number, number][],
  partial?: [number, number],
): Payload[] {
  const out: Payload[] = [
    { type: "MATCH_CREATED", matchId: "seed" },
    { type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" },
    { type: "MATCH_START" },
  ];
  let server: TeamId = "A";
  let side: CourtSide = "LEFT";
  let setNo = 1;
  let setsA = 0;
  let setsB = 0;
  for (let i = 0; i < sets.length; i++) {
    const [a, b] = sets[i];
    const winner: TeamId = a >= b ? "A" : "B";
    out.push(...setStartPayloads(discipline, setNo, server, side, A, B, n, false));
    out.push({ type: "SET_END", winner, scoreA: a, scoreB: b, setNumber: setNo });
    if (winner === "A") setsA++;
    else setsB++;
    if (i === sets.length - 1 && !partial) {
      out.push({ type: "MATCH_END", winner: setsA > setsB ? "A" : "B", setsA, setsB });
    }
    server = other(server);
    side = flip(side);
    setNo++;
  }
  if (partial) {
    out.push(...setStartPayloads(discipline, setNo, server, side, A, B, n, true));
    out.push(...rallyPayloads(partial[0], partial[1]));
  }
  return out;
}

const SYSTEM_EVENTS = new Set(["SET_END", "MATCH_END", "SIDE_SWITCH", "TTO_START"]);

async function generateMatch(
  matchId: string,
  discipline: Discipline,
  config: TournamentConfig,
  payloads: Payload[],
) {
  const engine = getEngine(discipline);
  if (!engine) throw new Error(`No engine for ${discipline}`);
  const pls = payloads.map((p) =>
    p.type === "MATCH_CREATED" ? { ...p, matchId } : p,
  );

  let state = engine.replay(matchId, [], config);
  const all: { id: string; sequence: number; timestamp: string; payload: Payload }[] = [];
  let seq = 0;
  for (const payload of pls) {
    const res = engine.append(state, payload, config, {
      nextSequence: seq + 1,
      timestamp: SEED_TS,
      makeId: () => newId("evt"),
    });
    if (!res.ok) {
      console.warn(`  · skip ${payload.type}: ${res.reason}`);
      continue;
    }
    for (const e of res.newEvents)
      all.push(e as { id: string; sequence: number; timestamp: string; payload: Payload });
    state = res.state;
    seq = state.lastSequence;

    if (state.rallyPhase === "TTO_ACTIVE") {
      const r = engine.append(state, { type: "TTO_END" }, config, {
        nextSequence: seq + 1,
        timestamp: SEED_TS,
        makeId: () => newId("evt"),
      });
      if (r.ok) {
        for (const e of r.newEvents)
          all.push(e as { id: string; sequence: number; timestamp: string; payload: Payload });
        state = r.state;
        seq = state.lastSequence;
      }
    }
  }

  let snap = engine.replay(matchId, [], config);
  const rows = all.map((e) => {
    snap = engine.reduce(snap, e, config);
    const d = engine.denormalize(snap);
    return {
      id: e.id,
      matchId,
      tenantId: TENANT.id,
      sequence: e.sequence,
      timestamp: new Date(e.timestamp),
      eventType: e.payload.type,
      payload: e.payload,
      actor: (SYSTEM_EVENTS.has(e.payload.type) ? "SYSTEM" : "SCORER") as
        | "SYSTEM"
        | "SCORER",
      ...d,
    };
  });
  if (rows.length) await db.insert(events).values(rows);

  await db
    .update(matches)
    .set({
      setsWonA: state.setsWonA,
      setsWonB: state.setsWonB,
      winner: state.winner,
      status: engine.matchStatusOf(state),
      startedAt: state.matchStartedAt ? new Date(state.matchStartedAt) : null,
      finishedAt: state.status === "FINISHED" ? new Date(SEED_TS) : null,
    })
    .where(eq(matches.id, matchId));
}

async function playMatch(
  matchId: string,
  discipline: Discipline,
  A: CreatedTeam,
  B: CreatedTeam,
  playersPerSide: number,
  sets: [number, number][],
  partial?: [number, number],
) {
  const config = await resolveMatchConfig(matchId);
  const payloads = buildPayloads(discipline, A, B, playersPerSide, sets, partial);
  await generateMatch(matchId, discipline, config, payloads);
}

// ── Discipline seeders ───────────────────────────────────────────────────────

async function seedBeach() {
  const id = "comp_beach";
  await db.insert(competitions).values({
    id,
    tenantId: TENANT.id,
    name: compName("Beach Lausanne"),
    discipline: "BEACH",
    gender: "MIXED",
    startDate: TODAY,
    endDate: TODAY,
    venue: "Place de la Navigation, Lausanne",
    status: "ACTIVE",
  });
  await db.insert(tournamentConfig).values({ competitionId: id, vcsEnabled: true });

  const A = await createTeam(id, { displayName: "Duda / Ana Patrícia", seed: 1, players: [
    { firstName: "Duda", lastName: "Lisboa", jerseyNumber: 1 },
    { firstName: "Ana Patrícia", lastName: "Ramos", jerseyNumber: 2 },
  ] });
  const B = await createTeam(id, { displayName: "Graudina / Kravcenoka", seed: 2, players: [
    { firstName: "Tīna", lastName: "Graudiņa", jerseyNumber: 1 },
    { firstName: "Anastasija", lastName: "Kravcenoka", jerseyNumber: 2 },
  ] });
  const C = await createTeam(id, { displayName: "Hughes / Cheng", seed: 3, players: [
    { firstName: "Sarah", lastName: "Hughes", jerseyNumber: 1 },
    { firstName: "Kelly", lastName: "Cheng", jerseyNumber: 2 },
  ] });
  const D = await createTeam(id, { displayName: "Borger / Sude", seed: 4, players: [
    { firstName: "Karla", lastName: "Borger", jerseyNumber: 1 },
    { firstName: "Julia", lastName: "Sude", jerseyNumber: 2 },
  ] });

  const m1 = await createMatch(id, "BEACH", A.id, B.id, 1, "Pool");
  await playMatch(m1, "BEACH", A, B, 2, [[21, 18], [21, 16]]);

  const m2 = await createMatch(id, "BEACH", C.id, D.id, 2, "Pool");
  await playMatch(m2, "BEACH", C, D, 2, [[21, 19]], [14, 11]);
  console.log("✓ Beach: finished 2-0, live set 2 @ 14-11");
}

async function seedIndoor() {
  const id = "comp_indoor";
  await db.insert(competitions).values({
    id,
    tenantId: TENANT.id,
    name: compName("Indoor Lausanne"),
    discipline: "INDOOR",
    gender: "WOMEN",
    startDate: TODAY,
    endDate: TODAY,
    venue: "Salle omnisports de Malley, Lausanne",
    status: "ACTIVE",
  });
  await db.insert(tournamentConfig).values({
    competitionId: id,
    bestOf: 5,
    vcsEnabled: true,
    teamTabletEnabled: true,
  });

  const A = await createTeam(id, { displayName: "Lausanne UC", seed: 1, clubName: "Lausanne UC", players: [
    { firstName: "Sophie", lastName: "Müller", jerseyNumber: 2, isCaptain: true },
    { firstName: "Emma", lastName: "Dubois", jerseyNumber: 3 },
    { firstName: "Clara", lastName: "Schmid", jerseyNumber: 4 },
    { firstName: "Laura", lastName: "Mayer", jerseyNumber: 7 },
    { firstName: "Nina", lastName: "Koch", jerseyNumber: 9 },
    { firstName: "Lisa", lastName: "Weber", jerseyNumber: 11 },
    { firstName: "Mia", lastName: "Fischer", jerseyNumber: 1, isLibero: true },
    { firstName: "Julia", lastName: "Braun", jerseyNumber: 5, bench: true },
    { firstName: "Anna", lastName: "Huber", jerseyNumber: 8, bench: true },
  ] });
  const B = await createTeam(id, { displayName: "Volley Schönenwerd", seed: 2, clubName: "Volley Schönenwerd", players: [
    { firstName: "Alicia", lastName: "Peng", jerseyNumber: 3, isCaptain: true },
    { firstName: "Valérie", lastName: "Gelin", jerseyNumber: 5 },
    { firstName: "Marta", lastName: "Rossi", jerseyNumber: 6 },
    { firstName: "Hannah", lastName: "Wolf", jerseyNumber: 8 },
    { firstName: "Sara", lastName: "Bauer", jerseyNumber: 10 },
    { firstName: "Lena", lastName: "Richter", jerseyNumber: 12 },
    { firstName: "Tanja", lastName: "Steiner", jerseyNumber: 2, isLibero: true },
    { firstName: "Petra", lastName: "Vogel", jerseyNumber: 4, bench: true },
    { firstName: "Monika", lastName: "Schwartz", jerseyNumber: 7, bench: true },
  ] });

  const m1 = await createMatch(id, "INDOOR", A.id, B.id, 1, "Round 5");
  await playMatch(m1, "INDOOR", A, B, 6, [[22, 25], [25, 22], [21, 25], [25, 20], [12, 15]]);

  const m2 = await createMatch(id, "INDOOR", A.id, B.id, 2, "Round 5");
  await playMatch(m2, "INDOOR", A, B, 6, [[25, 22], [23, 25]], [12, 14]);
  console.log("✓ Indoor: finished 2-3, live set 3 @ 12-14");
}

async function seedGrass() {
  const id = "comp_grass";
  await db.insert(competitions).values({
    id,
    tenantId: TENANT.id,
    name: compName("Grass Lausanne"),
    discipline: "GRASS",
    gender: "MIXED",
    startDate: TODAY,
    endDate: TODAY,
    venue: "Parc de l'Élysée, Lausanne",
    status: "ACTIVE",
  });
  await db.insert(tournamentConfig).values({ competitionId: id, playersPerSide: 3 });

  const mk = (name: string, seed: number, names: [string, string][]) =>
    createTeam(id, {
      displayName: name,
      seed,
      players: names.map(([f, l], i) => ({
        firstName: f,
        lastName: l,
        jerseyNumber: i + 1,
        bench: i === 3,
      })),
    });
  const A = await mk("Lausanne Rockets", 1, [["Marc", "Dupont"], ["Stéphane", "Blanc"], ["Pierre", "Noir"], ["Thomas", "Gris"]]);
  const B = await mk("Geneva Smashers", 2, [["Lucas", "Martin"], ["Antoine", "Bernard"], ["Kevin", "Petit"], ["Julien", "Grand"]]);
  const C = await mk("Bern Eagles", 3, [["Felix", "Keller"], ["Jonas", "Frei"], ["Noah", "Brunner"], ["Tim", "Suter"]]);
  const D = await mk("Zurich Thunder", 4, [["David", "Meier"], ["Leon", "Graf"], ["Elias", "Roth"], ["Robin", "Widmer"]]);

  const m1 = await createMatch(id, "GRASS", A.id, B.id, 1, "Pool");
  await playMatch(m1, "GRASS", A, B, 3, [[21, 18], [19, 21], [15, 11]]);

  const m2 = await createMatch(id, "GRASS", C.id, D.id, 2, "Pool");
  await playMatch(m2, "GRASS", C, D, 3, [[21, 17]], [9, 11]);
  console.log("✓ Grass: finished 2-1, live set 2 @ 9-11");
}

async function seedLight() {
  const id = "comp_light";
  await db.insert(competitions).values({
    id,
    tenantId: TENANT.id,
    name: compName("Light Vevey"),
    discipline: "LIGHT",
    gender: "MIXED",
    startDate: TODAY,
    endDate: TODAY,
    venue: "Salle des fêtes de Vevey",
    status: "ACTIVE",
  });
  await db.insert(tournamentConfig).values({ competitionId: id, playersPerSide: 4 });

  const mk = (name: string, seed: number, names: [string, string][]) =>
    createTeam(id, {
      displayName: name,
      seed,
      players: names.map(([f, l], i) => ({
        firstName: f,
        lastName: l,
        jerseyNumber: i + 1,
        bench: i === 4,
      })),
    });
  const A = await mk("Vevey Masters", 1, [["Paul", "Lemaire"], ["Jean", "Fontaine"], ["René", "Leclerc"], ["Michel", "Rousseau"], ["André", "Moreau"]]);
  const B = await mk("Montreux Seniors", 2, [["François", "Simon"], ["Jacques", "Girard"], ["Henri", "Roux"], ["Georges", "Lefort"], ["Claude", "Durand"]]);
  const C = await mk("Lausanne Vets", 3, [["Olivier", "Faure"], ["Daniel", "Mercier"], ["Bernard", "Bonnet"], ["Alain", "Lopez"], ["Gérard", "Fabre"]]);
  const D = await mk("Bienne Classics", 4, [["Marcel", "Gauthier"], ["Roger", "Perrin"], ["Yves", "Robin"], ["Serge", "Clément"], ["Hervé", "Masson"]]);

  const m1 = await createMatch(id, "LIGHT", A.id, B.id, 1, "Pool");
  await playMatch(m1, "LIGHT", A, B, 4, [[21, 17], [21, 14]]);

  const m2 = await createMatch(id, "LIGHT", C.id, D.id, 2, "Pool");
  const cfg = await resolveMatchConfig(m2);
  const payloads = buildPayloads("LIGHT", C, D, 4, [], [8, 6]);
  payloads.push({ type: "JUMP_SERVE_FOOT_FAULT", team: "B" });
  await generateMatch(m2, "LIGHT", cfg, payloads);
  console.log("✓ Light: finished 2-0, live set 1 @ ~8-6 (+ jump-serve fault)");
}

/**
 * Wipe the demo tenant's competitions and rebuild the four dated demo
 * competitions. `now` defaults to the current date; pass one for deterministic
 * tests. Returns a small summary for the cron route to log/return.
 */
export async function runDemoSeed(now: Date = new Date()) {
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  DATE_TAG = `${dd}${mm}`;
  TODAY = now.toISOString().slice(0, 10);
  SEED_TS = `${TODAY}T10:00:00.000Z`;

  await ensureTenant();
  await wipeAllForTenant();
  await seedBeach();
  await seedIndoor();
  await seedGrass();
  await seedLight();
  console.log(`✓ Demo seed complete (${DATE_TAG})`);
  return {
    dateTag: DATE_TAG,
    date: TODAY,
    competitions: [
      compName("Beach Lausanne"),
      compName("Indoor Lausanne"),
      compName("Grass Lausanne"),
      compName("Light Vevey"),
    ],
  };
}
