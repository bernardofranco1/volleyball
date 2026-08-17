import type { Discipline } from "./types";

/** Obligation to sign the scoresheet before a result is official. */
export const RESULT_SIGNATURE_POLICIES = ["REQUIRED", "OPTIONAL", "OFF"] as const;
export type ResultSignaturePolicy = (typeof RESULT_SIGNATURE_POLICIES)[number];

export function isResultSignaturePolicy(v: unknown): v is ResultSignaturePolicy {
  return (
    typeof v === "string" &&
    (RESULT_SIGNATURE_POLICIES as readonly string[]).includes(v)
  );
}

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
  ttoDurationSecs: number; // drives the TTO countdown (scorer + board)

  // ── Result approval (scoresheet signatures) ────────────────────────────────
  /**
   * Whether the final result must be signed on the scorer device before it
   * counts as official (beach/indoor scoresheet APPROVAL block):
   *   REQUIRED — both captains + the 1st referee must sign; a manager can still
   *              confirm without them, but only with a recorded reason.
   *   OPTIONAL — signing is offered on the console but never blocks.
   *   OFF      — no signing flow (disciplines with no scoresheet in use).
   */
  resultSignatures: ResultSignaturePolicy;

  // ── Time-outs ──────────────────────────────────────────────────────────────
  timeoutsPerSet: number;
  timeoutsPerSetTiebreak: number; // cap in the deciding set
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

  // ── Set breaks ─────────────────────────────────────────────────────────────
  // Duration (seconds) of the break after each set. Index i = break after set
  // (i+1). Durations may differ per break (e.g. a longer break before the
  // deciding set); an index past the array reuses the last value.
  setBreakDurationsSecs: number[];

  // ── Medical ──────────────────────────────────────────────────────────────
  medicalTimeoutSecs: number;
  /**
   * How many medical recoveries ONE player may take in a match, or null to
   * record without enforcing (spec/30 Phase F).
   *
   * INDOOR — Official Volleyball Rules 2025-2028, **Rule 17.1.2**: "If an
   * injured/ill player cannot be substituted legally or exceptionally, the
   * player is given a 3-minute recovery time, but not more than once for the
   * same player in the match." Hence 1, and hence `medicalTimeoutSecs: 180`.
   * If the player does not recover the team is declared incomplete (17.1.2 →
   * 6.4.3, 7.3.1) — which is the SET_DEFAULT event spec/29 F14 added.
   *
   * BEACH — null, and this is a VERIFIED absence rather than a missing source.
   * Official Beach Volleyball Rules 2025-2028, **Rule 17.1.2**: "An injured/ill
   * player is given a maximum of 5 minutes recovery time. […] If the player
   * does not recover or return to the playing area at the conclusion of the
   * recovery time, his/her team is declared incomplete." It caps the DURATION
   * (hence `medicalTimeoutSecs: 300`) and says nothing about how many times —
   * unlike indoor, which spells the count limit out. That difference is
   * structural, not an oversight: beach teams are two players with no
   * substitutions, so the indoor precondition "cannot be substituted legally
   * or exceptionally" has no analogue, and capping the count would force an
   * incomplete team rather than offer an alternative.
   *
   * spec/29 planned to cap beach at one per player per match. That would have
   * been WRONG — it would have refused a legal second recovery. The rulebook
   * is why we know.
   *
   * GRASS / LIGHT — null, source genuinely unselected (volleyball-codex
   * spec/20, the rule-source register). Record and print without capping.
   */
  recoveriesPerPlayerPerMatch: number | null;

  // ── Team tablets ──────────────────────────────────────────────────────────
  teamTabletEnabled: boolean;
  allowTeamTabletDirectEntry: boolean;

  // ── Sanctions ────────────────────────────────────────────────────────────
  /**
   * What the console does about the POINT a penalty awards (spec/29 F14).
   *
   * Recording stays fact-only either way — the sanction event never scores by
   * itself, exactly like the paper procedure. This only decides how much help
   * the scorer gets in not forgetting the consequence:
   *   PROMPT — offer a one-tap "award the point" straight after recording
   *            (default: the score can't drift, and nothing happens unasked)
   *   AUTO   — award it as part of recording
   *   OFF    — say nothing; the scorer taps the point as an ordinary rally
   */
  sanctionAutoPoint: SanctionAutoPoint;
}

/** How the console handles the point a penalty awards (spec/29 F14). */
export const SANCTION_AUTO_POINT = ["PROMPT", "AUTO", "OFF"] as const;
export type SanctionAutoPoint = (typeof SANCTION_AUTO_POINT)[number];

export function isSanctionAutoPoint(v: unknown): v is SanctionAutoPoint {
  return (
    typeof v === "string" && (SANCTION_AUTO_POINT as readonly string[]).includes(v)
  );
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
    // Beach rule 15.4.2: in sets 1 and 2, one 30-second Technical Time-Out is
    // applied automatically when the point sum reaches 21 (Beach Pro Tour
    // Elite16 / FIVB competitions). Organizers may run a different length only
    // with FIVB approval — hence the per-competition override.
    ttoDurationSecs: 30,

    resultSignatures: "REQUIRED", // FIVB beach scoresheet APPROVAL block

    timeoutsPerSet: 1,
    timeoutsPerSetTiebreak: 1,
    timeoutDurationSecs: 30,

    setBreakDurationsSecs: [60, 60, 60, 60],

    maxSubsPerSet: 0,
    substitutionZoneEnabled: false,

    playersPerSide: 2,

    rotationEnabled: false,
    lineupRequired: false,
    serverPlayerRequired: true, // track which of the 2 players serves

    liberoEnabled: false,
    liberoCount: 0,

    // Beach is scored without a serve clock on court — the widget was removed
    // from the beach console, so leave the broadcast off by default too.
    serveClockEnabled: false,
    serveClockSecs: 5,

    vcsEnabled: false,
    vcsChallengesPerSet: 2,

    attackLineM: null, // N/A — beach has no attack line
    backRowAttackEnabled: false,
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,

    blockCountsAsTeamHit: true,

    medicalTimeoutSecs: 300,
    // Beach Rule 17.1.2 caps the DURATION (5 min), not the count.
    recoveriesPerPlayerPerMatch: null,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,

    sanctionAutoPoint: "PROMPT",
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
    ttoDurationSecs: 30, // unused while ttoEnabled is false

    resultSignatures: "REQUIRED", // FIVB indoor scoresheet APPROVAL block

    timeoutsPerSet: 2,
    timeoutsPerSetTiebreak: 2,
    timeoutDurationSecs: 30,

    setBreakDurationsSecs: [180, 180, 180, 180],

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
    // Rule 17.1.2 — once per player per match.
    recoveriesPerPlayerPerMatch: 1,

    teamTabletEnabled: true,
    allowTeamTabletDirectEntry: false,

    sanctionAutoPoint: "PROMPT",
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
    ttoDurationSecs: 30, // unused while ttoEnabled is false

    resultSignatures: "OFF", // no scoresheet in use for Grass yet

    timeoutsPerSet: 2,
    timeoutsPerSetTiebreak: 2,
    timeoutDurationSecs: 30,

    setBreakDurationsSecs: [60, 60, 60, 60],

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
    // No verified source for this discipline — record, do not cap.
    recoveriesPerPlayerPerMatch: null,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,

    sanctionAutoPoint: "PROMPT",
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
    ttoDurationSecs: 30, // unused while ttoEnabled is false

    resultSignatures: "OFF", // no scoresheet in use for Light/Air yet

    timeoutsPerSet: 2,
    timeoutsPerSetTiebreak: 2,
    timeoutDurationSecs: 30,

    setBreakDurationsSecs: [60, 60, 60, 60],

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
    // No verified source for this discipline — record, do not cap.
    recoveriesPerPlayerPerMatch: null,

    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,

    sanctionAutoPoint: "PROMPT",
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

/** Whether `setNumber` is the deciding (tie-break) set for this config. */
export function isTiebreakSet(config: TournamentConfig, setNumber: number): boolean {
  return setNumber >= config.bestOf;
}

/** Time-out cap for a given set: the tie-break cap in the deciding set. */
export function timeoutCapForSet(config: TournamentConfig, setNumber: number): number {
  return isTiebreakSet(config, setNumber)
    ? config.timeoutsPerSetTiebreak
    : config.timeoutsPerSet;
}

/**
 * Break duration (seconds) after `setNumber` finishes. Index (setNumber-1) into
 * the per-break array; past the end reuses the last configured value. Falls back
 * to 60s if the array is empty/misconfigured.
 */
export function setBreakSecsAfter(config: TournamentConfig, setNumber: number): number {
  const arr = config.setBreakDurationsSecs;
  if (!Array.isArray(arr) || arr.length === 0) return 60;
  return arr[Math.min(setNumber - 1, arr.length - 1)] ?? arr[arr.length - 1] ?? 60;
}
