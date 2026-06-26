import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// All tables include `tenantId` for row-level multi-tenant isolation
// (enforced at the API layer, not Postgres RLS — see spec/03-DATABASE.md).
// All IDs are cuid2 strings; timestamps are UTC.

// ── Tenants ──────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tenantBranding = pgTable("tenant_branding", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#0066cc"),
  secondaryColor: text("secondary_color").default("#ffffff"),
  fontFamily: text("font_family"),
  courtColorOverrides: jsonb("court_color_overrides"),
});

// ── Users & roles ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Supabase Auth user id (uuid)
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userTenantRoles = pgTable(
  "user_tenant_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role", {
      enum: ["TENANT_ADMIN", "COMPETITION_ADMIN", "SCORER"],
    }).notNull(),
  },
  (t) => [unique().on(t.userId, t.tenantId, t.role)],
);

// ── Competitions ─────────────────────────────────────────────────────────────

export const competitions = pgTable("competitions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  discipline: text("discipline", {
    enum: ["BEACH", "INDOOR", "GRASS", "LIGHT"],
  }).notNull(),
  gender: text("gender", {
    enum: ["MEN", "WOMEN", "MIXED", "UNSPECIFIED"],
  }).default("UNSPECIFIED"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  venue: text("venue"),
  status: text("status", { enum: ["DRAFT", "ACTIVE", "FINISHED"] })
    .default("DRAFT")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One row per competition. All numeric/boolean fields nullable — null means
// "use the discipline default" (see src/engine/config.ts).
export const tournamentConfig = pgTable("tournament_config", {
  competitionId: text("competition_id")
    .primaryKey()
    .references(() => competitions.id),

  // Scoring
  bestOf: integer("best_of"),
  setScore: integer("set_score"),
  setScoreTiebreak: integer("set_score_tiebreak"),
  twoPointLead: boolean("two_point_lead"),

  // Side switches
  sideSwitchEnabled: boolean("side_switch_enabled"),
  sideSwitchEvery: integer("side_switch_every"),
  sideSwitchTiebreakEvery: integer("side_switch_tiebreak_every"),
  sideSwitchBetweenSetsOnly: boolean("side_switch_between_sets_only"),

  // TTO
  ttoEnabled: boolean("tto_enabled"),
  ttoTriggerScore: integer("tto_trigger_score"),

  // Timeouts
  timeoutsPerSet: integer("timeouts_per_set"),
  timeoutDurationSecs: integer("timeout_duration_secs"),

  // Substitutions
  maxSubsPerSet: integer("max_subs_per_set"),
  substitutionZoneEnabled: boolean("substitution_zone_enabled"),

  // Players per side
  playersPerSide: integer("players_per_side"),

  // Rotation
  rotationEnabled: boolean("rotation_enabled"),
  lineupRequired: boolean("lineup_required"),
  serverPlayerRequired: boolean("server_player_required"),

  // Libero
  liberoEnabled: boolean("libero_enabled"),
  liberoCount: integer("libero_count"),

  // Serve clock
  serveClockEnabled: boolean("serve_clock_enabled"),
  serveClockSecs: integer("serve_clock_secs"),

  // VCS
  vcsEnabled: boolean("vcs_enabled"),
  vcsChallengesPerSet: integer("vcs_challenges_per_set"),

  // Attack rules
  attackLineM: numeric("attack_line_m"),
  backRowAttackEnabled: boolean("back_row_attack_enabled"),
  frontZoneArcRequired: boolean("front_zone_arc_required"),
  jumpServeRestrictionLineM: numeric("jump_serve_restriction_line_m"),

  // Block
  blockCountsAsTeamHit: boolean("block_counts_as_team_hit"),

  // Medical
  medicalTimeoutSecs: integer("medical_timeout_secs"),

  // Team tablets
  teamTabletEnabled: boolean("team_tablet_enabled"),
  allowTeamTabletDirectEntry: boolean("allow_team_tablet_direct_entry"),
});

// ── Teams & players ──────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  displayName: text("display_name").notNull(),
  countryCode: text("country_code"), // ISO 3166-1 alpha-3 (optional)
  clubName: text("club_name"),
  seed: integer("seed"),
  poolId: text("pool_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const players = pgTable("players", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name").notNull(),
  jerseyNumber: integer("jersey_number"),
  isCaptain: boolean("is_captain").default(false).notNull(),
  isLibero: boolean("is_libero").default(false).notNull(),
  role: text("role", { enum: ["PLAYER", "BENCH", "STAFF"] })
    .default("PLAYER")
    .notNull(),
});

// ── Matches ──────────────────────────────────────────────────────────────────

export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),

  teamAId: text("team_a_id")
    .notNull()
    .references(() => teams.id),
  teamBId: text("team_b_id")
    .notNull()
    .references(() => teams.id),
  discipline: text("discipline", {
    enum: ["BEACH", "INDOOR", "GRASS", "LIGHT"],
  }).notNull(),

  status: text("status", {
    enum: ["SCHEDULED", "WARMUP", "COIN_TOSS", "LIVE", "FINISHED", "ABANDONED"],
  })
    .default("SCHEDULED")
    .notNull(),

  // Derived from replaying events — kept here for quick queries/standings.
  setsWonA: integer("sets_won_a").default(0).notNull(),
  setsWonB: integer("sets_won_b").default(0).notNull(),
  winner: text("winner", { enum: ["A", "B"] }),

  courtNumber: integer("court_number"),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),

  roundName: text("round_name"),
  matchNumber: integer("match_number"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Events (append-only log) ─────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    sequence: integer("sequence").notNull(), // monotonic per match

    timestamp: timestamp("timestamp").defaultNow().notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),

    // Denormalized for quick display/export (computed by the reducer).
    scoreAfterA: integer("score_after_a"),
    scoreAfterB: integer("score_after_b"),
    setNumber: integer("set_number"),
    serverTeam: text("server_team", { enum: ["A", "B"] }),
    serverPlayerNumber: integer("server_player_number"),
    sidesAfter: jsonb("sides_after"),

    actor: text("actor", {
      enum: ["SCORER", "TEAM_A", "TEAM_B", "SYSTEM"],
    }).notNull(),
    deviceInfo: text("device_info"),
    notes: text("notes"),
  },
  (t) => [
    unique().on(t.matchId, t.sequence),
    index("events_match_id_idx").on(t.matchId),
  ],
);

// ── Team tablet access tokens ────────────────────────────────────────────────

export const matchSessions = pgTable("match_sessions", {
  id: text("id").primaryKey(), // signed token sent to tablet
  matchId: text("match_id")
    .notNull()
    .references(() => matches.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  team: text("team", { enum: ["A", "B"] }).notNull(),
  role: text("role", { enum: ["SCORER", "TEAM_SCORER", "VIEWER"] }).notNull(),
  createdBy: text("created_by"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
});

// ── Team tablet lineup entry ─────────────────────────────────────────────────

export const lineupSubmissions = pgTable("lineup_submissions", {
  id: text("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => matches.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  team: text("team", { enum: ["A", "B"] }).notNull(),
  setNumber: integer("set_number").notNull(),
  playerIds: jsonb("player_ids").notNull(), // string[] in rotation order
  liberoId: text("libero_id"),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  status: text("status", { enum: ["PENDING", "CONFIRMED", "REJECTED"] })
    .default("PENDING")
    .notNull(),
});

// ── Team tablet TO/sub/challenge requests ────────────────────────────────────

export const interruptRequests = pgTable("interrupt_requests", {
  id: text("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => matches.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  team: text("team", { enum: ["A", "B"] }).notNull(),
  requestType: text("request_type", {
    enum: ["TIMEOUT", "SUBSTITUTION", "CHALLENGE", "MEDICAL"],
  }).notNull(),
  payload: jsonb("payload"),
  status: text("status", { enum: ["PENDING", "APPROVED", "DENIED"] })
    .default("PENDING")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
});

// ── Pools & standings ────────────────────────────────────────────────────────

export const pools = pgTable("pools", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id")
    .notNull()
    .references(() => competitions.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  roundName: text("round_name"),
});

export const poolTeams = pgTable(
  "pool_teams",
  {
    poolId: text("pool_id")
      .notNull()
      .references(() => pools.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
  },
  (t) => [primaryKey({ columns: [t.poolId, t.teamId] })],
);

// ── CSV import log ───────────────────────────────────────────────────────────

export const csvImports = pgTable("csv_imports", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  importType: text("import_type", {
    enum: ["TEAMS", "PLAYERS", "SCHEDULE", "RESULTS"],
  }).notNull(),
  filename: text("filename"),
  rowsOk: integer("rows_ok").default(0).notNull(),
  rowsError: integer("rows_error").default(0).notNull(),
  errors: jsonb("errors"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
});
