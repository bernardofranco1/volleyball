import type { Discipline } from "./types";

/**
 * The fully-resolved configuration the engine reads at runtime.
 *
 * This is a superset of the persisted `tournament_config` table (see
 * spec/03-DATABASE.md): a few fields here — e.g. `twoPointLead`,
 * `sideSwitchDecidingSetAt` — are derived defaults that are never stored as
 * columns. The persisted row holds nullable overrides; `resolveConfig()` layers
 * those (ignoring nulls) over the per-discipline defaults below.
 */
export interface TournamentConfig {
  // ── Scoring ──────────────────────────────────────────────────────────────
  bestOf: number; // 3 or 5
  setScore: number; // points to win a normal set
  setScoreTiebreak: number; // points to win the deciding set
  twoPointLead: boolean; // must win by two

  // ── Side switches ──────────────────────────────────────────────────────────
  sideSwitchEnabled: boolean;
  sideSwitchEvery: number | null; // points-sum interval (beach/grass)
  sideSwitchTiebreakEvery: number | null; // interval in the deciding set
  sideSwitchBetweenSetsOnly: boolean; // indoor/light
  sideSwitchDecidingSetAt: number | null; // deciding-set switch score (indoor/light: 8)

  // ── Technical time-out (TTO) ───────────────────────────────────────────────
  ttoEnabled: boolean;
  ttoTriggerScore: number | null;

  // ── Time-outs ──────────────────────────────────────────────────────────────
  timeoutsPerSet: number;
  timeoutDurationSecs: number;

  // ── Substitutions ──────────────────────────────────────────────────────────
  maxSubsPerSet: number;
  substitutionZoneEnabled: boolean;

  // ── Players ──────────────────────────────────────────────────────────────
  playersPerSide: number;

  // ── Rotation / lineup ──────────────────────────────────────────────────────
  rotationEnabled: boolean;
  lineupRequired: boolean;
  serverPlayerRequired: boolean;

  // ── Libero ──────────────────────────────────────────────────────────────
  liberoEnabled: boolean;
  liberoCount: number;

  // ── Serve clock ──────────────────────────────────────────────────────────
  serveClockEnabled: boolean;
  serveClockSecs: number;

  // ── Video Challenge System ─────────────────────────────────────────────────
  vcsEnabled: boolean;
  vcsChallengesPerSet: number;

  // ── Attack rules ──────────────────────────────────────────────────────────
  attackLineM: number | null;
  backRowAttackEnabled: boolean;
  frontZoneArcRequired: boolean; // Light VB only
  jumpServeRestrictionLineM: number | null; // Light VB only

  // ── Block ──────────────────────────────────────────────────────────────
  blockCountsAsTeamHit: boolean;

  // ── Medical ──────────────────────────────────────────────────────────────
  medicalTimeoutSecs: number;

  // ── Team tablets ──────────────────────────────────────────────────────────
  teamTabletEnabled: boolean;
  allowTeamTabletDirectEntry: boolean;
}

/**
 * Complete per-discipline defaults. Every field is set so `resolveConfig()`
 * always returns a total `TournamentConfig`. See spec/11-CONFIG.md.
 */
export const DISCIPLINE_DEFAULTS: Record<Discipline, TournamentConfig> = {
  BEACH: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    twoPointLead: true,

    sideSwitchEnabled: true,
    sideSwitchEvery: 7,
    sideSwitchTiebreakEvery: 5,
    sideSwitchBetweenSetsOnly: false,
    sideSwitchDecidingSetAt: null,

    ttoEnabled: true, // toggle off for non-official competitions
    ttoTriggerScore: 21,

    timeoutsPerSet: 1,
    timeoutDurationSecs: 30,

    maxSubsPerSet: 0,
    substitutionZoneEnabled: false,

    playersPerSide: 2,

    rotationEnabled: false,
    lineupRequired: false,
    serverPlayerRequired: true, // track which of the 2 players serves

    liberoEnabled: false,
    liberoCount: 0,

    serveClockEnabled: true,
    serveClockSecs: 5,

    vcsEnabled: false,
    vcsChallengesPerSet: 2,

    attackLineM: null, // N/A — beach has no attack line
    backRowAttackEnabled: false,
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,

    blockCountsAsTeamHit: true,

    medicalTimeoutSecs: 300,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },

  INDOOR: {
    bestOf: 5,
    setScore: 25,
    setScoreTiebreak: 15,
    twoPointLead: true,

    sideSwitchEnabled: true,
    sideSwitchEvery: null,
    sideSwitchTiebreakEvery: null,
    sideSwitchBetweenSetsOnly: true,
    sideSwitchDecidingSetAt: 8,

    ttoEnabled: false,
    ttoTriggerScore: null,

    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,

    maxSubsPerSet: 6,
    substitutionZoneEnabled: true,

    playersPerSide: 6,

    rotationEnabled: true,
    lineupRequired: true,
    serverPlayerRequired: true,

    liberoEnabled: true,
    liberoCount: 1,

    serveClockEnabled: true,
    serveClockSecs: 8,

    vcsEnabled: false,
    vcsChallengesPerSet: 2,

    attackLineM: 3.0,
    backRowAttackEnabled: true,
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,

    blockCountsAsTeamHit: false,

    medicalTimeoutSecs: 180,

    teamTabletEnabled: true,
    allowTeamTabletDirectEntry: false,
  },

  GRASS: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    twoPointLead: true,

    sideSwitchEnabled: true,
    sideSwitchEvery: 7,
    sideSwitchTiebreakEvery: 5,
    sideSwitchBetweenSetsOnly: false,
    sideSwitchDecidingSetAt: null,

    ttoEnabled: false,
    ttoTriggerScore: null,

    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,

    maxSubsPerSet: 4,
    substitutionZoneEnabled: false,

    playersPerSide: 3, // 3 or 4 per competition

    rotationEnabled: true,
    lineupRequired: true,
    serverPlayerRequired: true,

    liberoEnabled: false,
    liberoCount: 0,

    serveClockEnabled: true,
    serveClockSecs: 5,

    vcsEnabled: false,
    vcsChallengesPerSet: 2,

    attackLineM: null,
    backRowAttackEnabled: false,
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,

    blockCountsAsTeamHit: true,

    medicalTimeoutSecs: 300,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },

  LIGHT: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    twoPointLead: true,

    sideSwitchEnabled: true,
    sideSwitchEvery: null,
    sideSwitchTiebreakEvery: null,
    sideSwitchBetweenSetsOnly: true,
    sideSwitchDecidingSetAt: 8,

    ttoEnabled: false,
    ttoTriggerScore: null,

    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,

    maxSubsPerSet: 4, // 4 for 4-player; 5 for 5-player
    substitutionZoneEnabled: false,

    playersPerSide: 4, // 4 or 5 per competition

    rotationEnabled: true,
    lineupRequired: true,
    serverPlayerRequired: true,

    liberoEnabled: false,
    liberoCount: 0,

    serveClockEnabled: true,
    serveClockSecs: 8,

    vcsEnabled: false,
    vcsChallengesPerSet: 2,

    attackLineM: 2.0,
    backRowAttackEnabled: true, // back-row can attack from behind the 2m line
    frontZoneArcRequired: true, // unique to Light VB
    jumpServeRestrictionLineM: 1.0,

    blockCountsAsTeamHit: false,

    medicalTimeoutSecs: 300,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },
};

/**
 * Merge a (possibly partial, possibly null-filled) persisted config over the
 * discipline defaults. `null`/`undefined` overrides are ignored — they mean
 * "use the discipline default".
 */
export function resolveConfig(
  discipline: Discipline,
  dbConfig: Partial<TournamentConfig> = {},
): TournamentConfig {
  const overrides = Object.fromEntries(
    Object.entries(dbConfig).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<TournamentConfig>;

  return { ...DISCIPLINE_DEFAULTS[discipline], ...overrides };
}
