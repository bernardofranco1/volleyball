import { sql } from "drizzle-orm";
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
  uniqueIndex,
} from "drizzle-orm/pg-core";

// All tables include `tenantId` for multi-tenant isolation, enforced at the
// API layer (the app talks to Postgres over a direct connection as the owner
// role, which bypasses RLS). RLS is nonetheless ENABLED on every table with no
// policies, so the PostgREST-exposed anon/authenticated roles get deny-all —
// the app never uses PostgREST for table data (only Supabase Auth + Realtime
// broadcast), so this closes the REST exposure without affecting the app.
// All IDs are cuid2 strings; timestamps are UTC.

// ── Tenants ──────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Optional hostname label for subdomain routing (spec/23 §6): lowercase
  // DNS label, validated app-side against RESERVED_SUBDOMAINS. Null = tenant
  // reachable only via /t/{slug}.
  subdomain: text("subdomain").unique(),
  // Soft delete (spec/23 §3.4): non-null hides the tenant everywhere; hard
  // purge happens after a 7-day grace via the daily backup cron.
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

export const tenantBranding = pgTable("tenant_branding", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  // Display title shown instead of the "Volleyball Scoring" product name
  // (header wordmark + browser tab). Null → fall back to the tenant name.
  title: text("title"),
  logoUrl: text("logo_url"),
  // Printed in the top-right box of official e-scoresheets (e.g. a federation
  // logo). PNG/JPEG only — pdfkit can't embed WebP/SVG; non-embeddable or
  // unreachable URLs fall back to the text header at render time.
  scoresheetLogoUrl: text("scoresheet_logo_url"),
  primaryColor: text("primary_color").default("#0066cc"),
  secondaryColor: text("secondary_color").default("#ffffff"),
  fontFamily: text("font_family"),
  courtColorOverrides: jsonb("court_color_overrides"),
}).enableRLS();

// Per-tenant capability configuration (spec/24 §2.1). Separate from branding
// because it gates behaviour, not looks — which disciplines this tenant may run
// competitions in, and which match documents its Reports tab offers.
//
// A missing row means "everything enabled", so existing tenants keep working
// unchanged until an admin narrows it; readers fall back to the defaults below
// rather than requiring a backfill. Stored as jsonb string arrays and always
// re-validated on read against DISCIPLINES / REPORT_TYPES — never trusted raw,
// since a hand-edited row or a removed enum member would otherwise reach the UI.
export const tenantConfig = pgTable("tenant_config", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  enabledDisciplines: jsonb("enabled_disciplines").$type<string[]>(),
  enabledReportTypes: jsonb("enabled_report_types").$type<string[]>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}).enableRLS();

// Per-competition scoreboard appearance (configurable from the competition's
// Scoreboard config tab). All nullable → fall back to per-discipline board
// defaults. Applies to every discipline's broadcast board.
export const competitionBranding = pgTable("competition_branding", {
  competitionId: text("competition_id")
    .primaryKey()
    .references(() => competitions.id),
  bgColor: text("bg_color"),
  lineColor: text("line_color"),
  accentColor: text("accent_color"),
  fontColor: text("font_color"),
  fontFamily: text("font_family"),
  logoUrl: text("logo_url"),
}).enableRLS();

// ── Users & roles ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Supabase Auth user id (uuid)
  email: text("email").notNull(),
  name: text("name"),
  // Platform-level superadmin (spec/23 §3): implicit TENANT_ADMIN in every
  // tenant + access to /admin. Deliberately no UI to set it — flipping the
  // flag is a DB-only operation.
  isGlobalAdmin: boolean("is_global_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

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
      enum: ["TENANT_ADMIN", "COMPETITION_ADMIN", "SCORER", "VIEWER"],
    }).notNull(),
  },
  (t) => [
    unique().on(t.userId, t.tenantId, t.role),
    // Members list / last-admin guard query by tenant first; the unique above
    // leads with userId so it can't serve them.
    index("user_tenant_roles_tenant_idx").on(t.tenantId),
  ],
).enableRLS();

// ── Competitions ─────────────────────────────────────────────────────────────

export const competitions = pgTable(
  "competitions",
  {
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
    // Official scoresheet header (spec/21): venue split + age category.
    // Indoor sheet prints City/Country/Hall; beach prints Site/Beach — we map
    // city→Site and hall→Beach there. All nullable: blank cells on the sheet.
    city: text("city"),
    country: text("country"),
    hall: text("hall"),
    // IANA zone of the VENUE (spec/29 F5), e.g. "Europe/Zurich". Every time on
    // the official sheet is printed in it; null keeps today's behaviour, which
    // is UTC. Not derived from the server or the reader's browser: the sheet is
    // a document about a place, and a match at 20:00 local must not print as
    // 18:00 because it was generated elsewhere.
    timezone: text("timezone"),
    category: text("category", {
      enum: ["SENIOR", "JUNIOR", "YOUTH", "KID"],
    }),
    color: text("color"), // hex accent (nullable) — tints the name on the Matches page
    status: text("status", { enum: ["DRAFT", "ACTIVE", "FINISHED"] })
      .default("DRAFT")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // Postgres doesn't auto-index FKs; the competitions list is always
  // tenant-scoped and ordered by creation date.
  (t) => [index("competitions_tenant_idx").on(t.tenantId, t.createdAt)],
).enableRLS();

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
  ttoDurationSecs: integer("tto_duration_secs"),

  // Obligation to sign the scoresheet before the result is official (spec/20).
  resultSignatures: text("result_signatures", {
    enum: ["REQUIRED", "OPTIONAL", "OFF"],
  }),

  // Timeouts
  timeoutsPerSet: integer("timeouts_per_set"),
  timeoutsPerSetTiebreak: integer("timeouts_per_set_tiebreak"),
  timeoutDurationSecs: integer("timeout_duration_secs"),

  // Set breaks — per-break durations (seconds), index i = break after set i+1.
  setBreakDurationsSecs: jsonb("set_break_durations_secs").$type<number[]>(),

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
  // Recoveries one player may take per match (spec/30 Phase F). Indoor
  // defaults to 1 per Rule 17.1.2; null override = use the discipline default.
  recoveriesPerPlayerPerMatch: integer("recoveries_per_player_per_match"),

  // Team tablets
  teamTabletEnabled: boolean("team_tablet_enabled"),
  allowTeamTabletDirectEntry: boolean("allow_team_tablet_direct_entry"),

  // Sanctions: what the console does about the point a penalty awards
  // (spec/29 F14). Nullable override like every column here; the per-discipline
  // default is PROMPT.
  sanctionAutoPoint: text("sanction_auto_point", {
    enum: ["PROMPT", "AUTO", "OFF"],
  }),
}).enableRLS();

// ── Teams & players ──────────────────────────────────────────────────────────

export const teams = pgTable(
  "teams",
  {
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
    color: text("color"), // team colour (hex) for scoreboards/UI — brief §1.4
    poolId: text("pool_id").references(() => pools.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("teams_competition_idx").on(t.competitionId)],
).enableRLS();

// ── People (spec/24 §6) ──────────────────────────────────────────────────────
//
// Tenant-level registry of the humans a competition involves: players, referees,
// coaches, scorers. Before this, a "player" existed only as a row under one
// team in one competition and an official was a name retyped on every match, so
// nothing about a person could be reused, corrected once, or matched to an
// external record.
//
// Field choices are deliberately VIS-shaped so a future push into the FIVB VIS
// person modules is a mapping rather than a redesign (spec/24 §7):
//   - `displayName` is separate from `lastName` because VIS's TeamName is a
//     shirt/scoreboard label, NOT a surname. Treating it as one is a real
//     production incident: names rendered as "Thatdao N.Thatdao".
//   - `lastName` is nullable: VIS holds players who genuinely have no surname.
//   - measurements are human units here; VIS's 1/1000-mm and 1/1000-g scaling
//     belongs in the connector, not the store.
//   - `visPersonNo` is VIS's person `No` — the join key for any later sync. It
//     is NOT the registration number, which is a different id space entirely.
export const people = pgTable(
  "people",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /**
     * The name that appears on the shirt and therefore on EVERY match-facing
     * output: scoring console, scoreboard, substitution and lineup pickers,
     * e-scoresheets, PDFs and the VSR feed (spec/26).
     *
     * First/last name are registration data and deliberately do NOT reach those
     * surfaces. Before this field existed the boards derived a label by guessing
     * a surname out of the full name, which mangles the conventions federations
     * actually use ("Sørum, C.", "EGONU", "N.THATDAO"). VIS models it the same
     * way — its `TeamName` is a shirt label, not a surname.
     */
    jerseyName: text("jersey_name").notNull(),
    gender: text("gender", { enum: ["M", "W"] }),
    // ── Identity (spec/25) ────────────────────────────────────────────────
    // The goal is one row per human per tenant. These are what make that
    // enforceable: names alone can't identify a person (they collide, and some
    // people have no surname), so matching goes vis_person_no → email →
    // (last, first, birthdate, federation).
    //
    // Both email and birthdate are NULLABLE by necessity, not by laziness:
    // minors frequently have no address of their own, families share one, and
    // referees change theirs. Hence unique-WHEN-PRESENT below rather than a
    // plain unique, which would make the field effectively mandatory.
    email: text("email"),
    birthdate: date("birthdate"),
    /**
     * Login account, when this person has one (spec/25 §3). Nullable — most
     * people in the registry never sign in. This is what will let a referee open
     * their own nominations and availability card in the Referees' Hub, rather
     * than an admin reading them out.
     */
    userId: text("user_id").references(() => users.id),
    /** 3-letter federation code as VIS uses them (NOR, ITA, …). */
    federationCode: text("federation_code"),
    heightCm: integer("height_cm"),
    weightKg: integer("weight_kg"),
    position: text("position", {
      enum: [
        "SETTER",
        "WING_SPIKER",
        "MIDDLE_BLOCKER",
        "LIBERO",
        "UNIVERSAL",
        "OPPOSITE",
      ],
    }),
    spikeReachCm: integer("spike_reach_cm"),
    blockReachCm: integer("block_reach_cm"),
    handedness: text("handedness", { enum: ["LEFT", "RIGHT"] }),
    photoUrl: text("photo_url"),
    /** Free text until FIVB supply the GetReferee field list (spec/24 §7.4). */
    refereeLevel: text("referee_level"),
    visPersonNo: integer("vis_person_no"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("people_tenant_idx").on(t.tenantId),
    index("people_tenant_name_idx").on(t.tenantId, t.lastName, t.firstName),
    // One row per VIS person per tenant, but only for rows that carry an id.
    uniqueIndex("people_tenant_vis_uq")
      .on(t.tenantId, t.visPersonNo)
      .where(sql`${t.visPersonNo} is not null`),
    // Same idea for the two other identity keys (spec/25 §2). Scoped to the
    // tenant, not global: a person who works for two customers of the platform
    // gets one row in each, correlated by these keys but never readable across
    // the boundary — sharing the row would let one tenant discover a person the
    // other registered.
    uniqueIndex("people_tenant_email_uq")
      .on(t.tenantId, t.email)
      .where(sql`${t.email} is not null`),
    uniqueIndex("people_tenant_user_uq")
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} is not null`),
    // Supports the duplicate finder's name+birthdate probe.
    index("people_tenant_birthdate_idx").on(t.tenantId, t.birthdate),
  ],
).enableRLS();

// A person can hold several roles at once — a coach who also referees, a scorer
// who plays. Role-specific attributes beyond refereeLevel wait for the FIVB
// field lists rather than being invented here (spec/24 §7.4).
export const personRoles = pgTable(
  "person_roles",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role", {
      enum: ["PLAYER", "REFEREE", "COACH", "SCORER"],
    }).notNull(),
  },
  (t) => [
    unique().on(t.personId, t.role),
    index("person_roles_tenant_role_idx").on(t.tenantId, t.role),
  ],
).enableRLS();

export const players = pgTable("players", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  // A roster row is a MEMBERSHIP, not a person (spec/24 §2.3). The name columns
  // that used to live here are gone as of migration 0012: they were a per-team,
  // per-competition copy of a human, which is exactly the duplication the
  // registry removes. Jersey number, captain and libero stay — they are facts
  // about this roster spot, not about the person, which is how VIS models it too
  // (shirt number lives on the tournament registration, not the player record).
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  jerseyNumber: integer("jersey_number"),
  isCaptain: boolean("is_captain").default(false).notNull(),
  isLibero: boolean("is_libero").default(false).notNull(),
  role: text("role", { enum: ["PLAYER", "BENCH", "STAFF"] })
    .default("PLAYER")
    .notNull(),
  // The letter this bench official prints as on the official scoresheet's TEAMS
  // block and in the sanctions grid (spec/29 F1): C1 coach, A1-A3 assistant
  // coaches, D1 doctor, T therapist, P physiotherapist. Meaningful only when
  // `role = 'STAFF'`; nullable everywhere else, and nullable for staff too —
  // a bench official with no declared function still prints, without a code.
  //
  // Staff live HERE, on the roster, and not on `team_staff`: every match
  // surface (scorer console, sanctions, sign-off, the VSR export) reads rosters
  // through loadMatchRosters, and none of them read team_staff. See spec/29
  // §Revalidation §1.
  staffFunction: text("staff_function", {
    enum: ["C1", "A1", "A2", "A3", "D1", "T", "P"],
  }),
}, (t) => [
  // One jersey number per team. NULLs are distinct in Postgres, so bench/staff
  // without a number are unaffected. Brief §2.1.
  uniqueIndex("players_team_jersey_uq").on(t.teamId, t.jerseyNumber),
  // One roster spot per person per team (spec/25 §4). Without this, the same
  // person could be added to a team twice — trivially, by giving them a second
  // jersey or no jersey at all — which is the duplication the registry exists to
  // remove. No longer partial: person_id is NOT NULL as of migration 0012.
  uniqueIndex("players_team_person_uq").on(t.teamId, t.personId),
]).enableRLS();

// ── Matches ──────────────────────────────────────────────────────────────────

export const matches = pgTable(
  "matches",
  {
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
      enum: [
        "SCHEDULED",
        "WARMUP",
        "COIN_TOSS",
        "LIVE",
        "PENDING_CONFIRMATION",
        "FINISHED",
        "ABANDONED",
      ],
    })
      .default("SCHEDULED")
      .notNull(),

    // Derived from replaying events — kept here for quick queries/standings.
    setsWonA: integer("sets_won_a").default(0).notNull(),
    setsWonB: integer("sets_won_b").default(0).notNull(),
    winner: text("winner", { enum: ["A", "B"] }),

    // Cached replay snapshot (spec/14 §C1): the full engine state after
    // `snapshotSequence`. Reads load this + replay only events beyond it, bounding
    // replay cost. Treated as a cache — if absent/behind, a tail/full replay heals.
    stateSnapshot: jsonb("state_snapshot"),
    snapshotSequence: integer("snapshot_sequence").default(0).notNull(),

    courtNumber: integer("court_number"),
    scheduledAt: timestamp("scheduled_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),

    roundName: text("round_name"),
    // VIS match number — join key for the VSR live feed (spec/22). Nullable:
    // dispatch is skipped when unset.
    visId: text("vis_id"),
    matchNumber: integer("match_number"),
    // Group / phase metadata for schedule imports (brief §3.2).
    groupName: text("group_name"),
    phaseNumber: integer("phase_number"),
    phaseName: text("phase_name"),
    scorerPin: text("scorer_pin"), // per-match 6-digit scorer gate (brief §5.2)

    // Result approval (spec/20). A scorer's final point parks the match at
    // PENDING_CONFIRMATION; it becomes FINISHED either when the scoresheet is
    // signed (SIGNATURES) or when a manager confirms it (ADMIN).
    confirmedAt: timestamp("confirmed_at"),
    confirmedBy: text("confirmed_by"),
    confirmedVia: text("confirmed_via", { enum: ["SIGNATURES", "ADMIN"] }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Hot query paths (Postgres doesn't auto-index FKs): per-competition
    // listings/standings, the tenant-wide match centre (ordered by time), and
    // the delete-team referential guard.
    index("matches_competition_status_idx").on(t.competitionId, t.status),
    index("matches_tenant_sched_idx").on(t.tenantId, t.scheduledAt),
    index("matches_team_a_idx").on(t.teamAId),
    index("matches_team_b_idx").on(t.teamBId),
    // One knockout slot per (competition, round, match#) — backstops the
    // advisory lock in bracket generation (spec/14 §E1/M4).
    uniqueIndex("matches_knockout_slot")
      .on(t.competitionId, t.roundName, t.matchNumber)
      .where(
        sql`${t.roundName} in ('Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinal', 'Semifinal', 'Final', '3rd Place')`,
      ),
  ],
).enableRLS();

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
    // The authenticated user (Supabase auth uuid) behind the action, when one
    // exists — the audit anchor for corrections (UNDO/REWIND). No FK: this is
    // the hottest insert path, and the record must outlive account deletion.
    actorUserId: text("actor_user_id"),
    deviceInfo: text("device_info"),
    notes: text("notes"),
  },
  // unique(matchId, sequence) doubles as the match_id lookup index (leading
  // column); a separate single-column index was pure write amplification on
  // the hottest insert path.
  (t) => [unique().on(t.matchId, t.sequence)],
).enableRLS();

// ── Team tablet access tokens ────────────────────────────────────────────────

export const matchSessions = pgTable(
  "match_sessions",
  {
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
  },
  (t) => [index("match_sessions_match_idx").on(t.matchId)],
).enableRLS();

// Team-tablet lineups are submitted directly as LINEUP_CONFIRMED events (the
// event log is the source of truth), so there is no separate submissions table.

// ── Team tablet TO/sub/challenge requests ────────────────────────────────────

export const interruptRequests = pgTable(
  "interrupt_requests",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    team: text("team", { enum: ["A", "B"] }).notNull(),
    requestType: text("request_type", {
      // TS-only enum (no DB constraint) — PROTEST added by spec/29 F12.
      enum: ["TIMEOUT", "SUBSTITUTION", "CHALLENGE", "MEDICAL", "PROTEST"],
    }).notNull(),
    payload: jsonb("payload"),
    status: text("status", { enum: ["PENDING", "APPROVED", "DENIED"] })
      .default("PENDING")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  // Polled by every scorer console — (matchId, status) matches the PENDING scan.
  (t) => [index("interrupt_requests_match_status_idx").on(t.matchId, t.status)],
).enableRLS();

// ── Result approval: officials & scoresheet signatures (spec/20) ─────────────

/**
 * Match officials as printed in the scoresheet APPROVAL block. Today only the
 * 1st referee is captured — typed at the table when the scoresheet is signed
 * (`source: MANUAL`) — but the roles the beach and indoor sheets carry are all
 * modelled so the later "officials arrive with the match data" import has a
 * home to write to (`source: IMPORT`) with no schema change.
 */
export const matchOfficials = pgTable(
  "match_officials",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role", {
      enum: [
        "FIRST_REFEREE",
        "SECOND_REFEREE",
        "SCORER",
        "ASSISTANT_SCORER",
        "THIRD_REFEREE",
        "CHALLENGE_REFEREE",
        "LINE_JUDGE_1",
        "LINE_JUDGE_2",
        "LINE_JUDGE_3",
        "LINE_JUDGE_4",
      ],
    }).notNull(),
    // The registry person this slot was filled by (spec/24 §2.4). Required as of
    // migration 0012 — every officials slot resolves to a real person.
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    // name/country/level are KEPT after the migration, as a snapshot of what was
    // printed on the sheet at match time. A scoresheet is a historical record:
    // correcting a person's spelling next season must not silently rewrite an
    // already-signed document, so the officials form copies these from the
    // picked person on save rather than joining at print time (spec/24 §2.4).
    name: text("name").notNull(),
    // Printed by the beach sheet (Country) and the indoor sheet (Level). Both
    // optional — name only is required today.
    country: text("country"),
    level: text("level"),
    source: text("source", { enum: ["MANUAL", "IMPORT"] })
      .default("MANUAL")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by"),
  },
  (t) => [unique("match_officials_role").on(t.matchId, t.role)],
).enableRLS();

// Bench staff for a team (spec/24 §2.5). Closes spec/21 gap G4 on the data side:
// the coach box on the official scoresheets printed blank because no coach
// entity existed anywhere.
//
// The function list mirrors VIS's VolleyTeam staff fields (HeadCoachName/
// CtryCode, AssistCoachName, AssistCoach2, Doctor, Trainer, Manager) so a later
// VIS push has a 1:1 target. Note VIS stores these as plain name+country strings
// with no person ids, so this direction of the mapping is lossy by VIS's design,
// not ours (spec/24 §7.3).
export const teamStaff = pgTable(
  "team_staff",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    function: text("function", {
      enum: [
        "HEAD_COACH",
        "ASSISTANT_COACH",
        "ASSISTANT_COACH_2",
        "DOCTOR",
        "TRAINER",
        "MANAGER",
      ],
    }).notNull(),
  },
  (t) => [unique("team_staff_function").on(t.teamId, t.function)],
).enableRLS();

/**
 * Signatures collected on the scorer device after the match: both captains and
 * the 1st referee. Retained permanently — they are part of the official
 * document, so a superseded signature is INVALIDATED (never deleted).
 *
 * `resultDigest` + `signedSequence` bind a signature to one exact state of the
 * event log, so a later undo/rewind cannot silently re-attribute consent to a
 * different score: reopening a signed match invalidates all three.
 *
 * `strokes` holds vector polylines normalised to the pad (0..1), not a raster
 * image — it draws crisply into the PDF and never reaches a CDN.
 */
export const matchSignatures = pgTable(
  "match_signatures",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role", {
      // The confirmation trio (spec/20) + pre-match captains and the scorer
      // bench (spec/21 Phase D). Text enum = TS-only; no DB migration needed.
      enum: [
        "TEAM_A_CAPTAIN",
        "TEAM_B_CAPTAIN",
        "FIRST_REFEREE",
        "TEAM_A_CAPTAIN_PREMATCH",
        "TEAM_B_CAPTAIN_PREMATCH",
        // Pre-match coach signatures (spec/29 F3) — beach TEAMS p2 box.
        "TEAM_A_COACH_PREMATCH",
        "TEAM_B_COACH_PREMATCH",
        "SCORER",
        "ASSISTANT_SCORER",
      ],
    }).notNull(),
    signerName: text("signer_name").notNull(),
    signerPlayerId: text("signer_player_id").references(() => players.id),
    // Vector strokes, or null when the signer refused to sign.
    strokes: jsonb("strokes").$type<{
      pad: { w: number; h: number };
      strokes: number[][][];
    }>(),
    intent: text("intent", { enum: ["ACCEPT", "PROTEST", "REFUSED"] })
      .default("ACCEPT")
      .notNull(),
    remarks: text("remarks"),
    signedAt: timestamp("signed_at").defaultNow().notNull(),
    signedSequence: integer("signed_sequence").notNull(),
    resultDigest: text("result_digest").notNull(),
    // The authenticated session that captured the signature on the device.
    capturedBy: text("captured_by"),
    deviceInfo: text("device_info"),
    invalidatedAt: timestamp("invalidated_at"),
    invalidatedReason: text("invalidated_reason"),
  },
  (t) => [
    index("match_signatures_match_idx").on(t.matchId),
    // One live signature per role; invalidated ones stay for the record.
    uniqueIndex("match_signatures_live_role")
      .on(t.matchId, t.role)
      .where(sql`${t.invalidatedAt} is null`),
  ],
).enableRLS();

// ── Pools & standings ────────────────────────────────────────────────────────

export const pools = pgTable(
  "pools",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    roundName: text("round_name"),
  },
  (t) => [index("pools_competition_idx").on(t.competitionId)],
).enableRLS();

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
).enableRLS();

// ── CSV import log ───────────────────────────────────────────────────────────

export const csvImports = pgTable(
  "csv_imports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    importType: text("import_type", {
      enum: ["TEAMS", "PLAYERS", "SCHEDULE", "RESULTS", "ROSTER"],
    }).notNull(),
    filename: text("filename"),
    rowsOk: integer("rows_ok").default(0).notNull(),
    rowsError: integer("rows_error").default(0).notNull(),
    errors: jsonb("errors"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by"),
  },
  (t) => [index("csv_imports_tenant_idx").on(t.tenantId, t.createdAt)],
).enableRLS();

// ── Admin audit log (Phase 11) ───────────────────────────────────────────────
// Append-only record of sensitive admin mutations (lifecycle, deletes, bracket,
// branding, token issuance, bulk imports). Written best-effort; never blocks the
// operation it records.

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    // NULL = a PLATFORM-level event with no tenant to file under: impersonation
    // start/stop, global-admin flag flips, password resets (spec/26 §9). Before
    // migration 0017 this was NOT NULL, and those actions were simply not
    // audited at all. Tenant-scoped exports filter on tenant_id, so platform
    // rows are deliberately absent from per-tenant backups.
    tenantId: text("tenant_id").references(() => tenants.id),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(), // e.g. "competition.activate"
    entityType: text("entity_type"), // "competition" | "team" | "match" | …
    entityId: text("entity_id"),
    summary: text("summary"), // human-readable one-liner
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("audit_log_tenant_idx").on(t.tenantId, t.createdAt)],
).enableRLS();

// ── Backup runs (spec/23 §7) ─────────────────────────────────────────────────
// One row per backup attempt (including failures — a FAILED row is how a missed
// backup becomes visible in the admin console instead of silently absent).
// Objects live in the private Supabase Storage bucket `backups`.

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: text("kind", { enum: ["FULL", "INCREMENTAL"] }).notNull(),
    trigger: text("trigger", { enum: ["CRON", "EVENT", "MANUAL"] }).notNull(),
    // e.g. { competitionId } for competition-scoped incrementals.
    scope: jsonb("scope").$type<{ competitionId?: string } | null>(),
    status: text("status", { enum: ["RUNNING", "OK", "FAILED"] })
      .default("RUNNING")
      .notNull(),
    objectPath: text("object_path"),
    sizeBytes: integer("size_bytes"),
    rowCounts: jsonb("row_counts").$type<Record<string, number> | null>(),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  // Console history + the incremental debounce query by tenant, newest first.
  (t) => [index("backup_runs_tenant_started_idx").on(t.tenantId, t.startedAt)],
).enableRLS();

// ── Tenant billing (Phase 11 scaffold — Stripe, "future") ────────────────────
// One row per tenant, kept in sync by the Stripe webhook. Inert until Stripe is
// configured; defaults leave every tenant on "free"/"none".

export const tenantBilling = pgTable("tenant_billing", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  plan: text("plan").default("free").notNull(),
  status: text("status", {
    enum: ["none", "trialing", "active", "past_due", "canceled", "incomplete"],
  })
    .default("none")
    .notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}).enableRLS();

// ── Release history (spec/28 §7) ─────────────────────────────────────────────
// One row per promotion, written by the release console. Platform-level, not
// tenant-scoped: a release is the whole deployment, not one organisation's data.
//
// This is the promotion log AND the rollback menu: every row names a Vercel
// deployment that was built with production configuration and served the domain,
// so promoting it again is a rollback with no rebuild.

export const releases = pgTable(
  "releases",
  {
    id: text("id").primaryKey(),
    /** The Vercel deployment that took the domain. */
    deploymentId: text("deployment_id").notNull(),
    sha: text("sha").notNull(),
    /** First line of the commit message, for reading the history at a glance. */
    message: text("message"),
    branch: text("branch"),
    /** What it replaced — the natural rollback target for this release. */
    previousDeploymentId: text("previous_deployment_id"),
    /**
     * How the schema stood when this shipped: how many migrations the repo had
     * versus how many production had applied. A release that ran migrations is
     * the one whose rollback needs thought (spec/28 §6).
     */
    migrationsInRepo: integer("migrations_in_repo"),
    migrationsApplied: integer("migrations_applied"),
    action: text("action", { enum: ["PROMOTE", "ROLLBACK"] })
      .default("PROMOTE")
      .notNull(),
    promotedBy: text("promoted_by"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("releases_created_idx").on(t.createdAt)],
).enableRLS();
