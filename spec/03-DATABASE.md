# 03 — Database Schema

## Database: Supabase PostgreSQL via Drizzle ORM

All tables include `tenantId` for row-level multi-tenant isolation.

---

## tenants

```ts
export const tenants = pgTable("tenants", {
  id:           text("id").primaryKey(),  // cuid2
  slug:         text("slug").notNull().unique(),  // URL slug
  name:         text("name").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const tenantBranding = pgTable("tenant_branding", {
  tenantId:           text("tenant_id").primaryKey().references(() => tenants.id),
  logoUrl:            text("logo_url"),
  primaryColor:       text("primary_color").default("#0066cc"),
  secondaryColor:     text("secondary_color").default("#ffffff"),
  fontFamily:         text("font_family"),
  courtColorOverrides: jsonb("court_color_overrides"),  // { beach?: {...}, indoor?: {...} }
});
```

---

## users and roles

```ts
export const users = pgTable("users", {
  id:        text("id").primaryKey(),  // Supabase Auth user id (uuid)
  email:     text("email").notNull(),
  name:      text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userTenantRoles = pgTable("user_tenant_roles", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id),
  tenantId:  text("tenant_id").notNull().references(() => tenants.id),
  role:      text("role", { enum: ["TENANT_ADMIN", "COMPETITION_ADMIN", "SCORER"] }).notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.tenantId, t.role),
}));
```

---

## competitions

```ts
export const competitions = pgTable("competitions", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull().references(() => tenants.id),
  name:        text("name").notNull(),
  discipline:  text("discipline", { enum: ["BEACH", "INDOOR", "GRASS", "LIGHT"] }).notNull(),
  gender:      text("gender", { enum: ["MEN", "WOMEN", "MIXED", "UNSPECIFIED"] }).default("UNSPECIFIED"),
  startDate:   date("start_date"),
  endDate:     date("end_date"),
  venue:       text("venue"),
  status:      text("status", { enum: ["DRAFT", "ACTIVE", "FINISHED"] }).default("DRAFT").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
```

---

## tournament_config

One row per competition. All numeric/boolean fields are nullable — null means "use discipline default".

```ts
export const tournamentConfig = pgTable("tournament_config", {
  competitionId:   text("competition_id").primaryKey().references(() => competitions.id),

  // ── Scoring ────────────────────────────────────────────────────────────
  bestOf:              integer("best_of"),           // 3 or 5 (default: 3 for beach/grass/light, 5 for indoor)
  setScore:            integer("set_score"),         // points to win a set (21 or 25)
  setScoreTiebreak:    integer("set_score_tiebreak"), // points to win deciding set (15)
  twoPointLead:        boolean("two_point_lead"),    // true always; here for explicitness

  // ── Side switches ──────────────────────────────────────────────────────
  sideSwitchEnabled:         boolean("side_switch_enabled"),
  sideSwitchEvery:           integer("side_switch_every"),          // pts sum interval (7 for beach/grass)
  sideSwitchTiebreakEvery:   integer("side_switch_tiebreak_every"), // pts sum interval in set 3 (5)
  sideSwitchBetweenSetsOnly: boolean("side_switch_between_sets_only"), // Light VB / Indoor

  // ── TTO ────────────────────────────────────────────────────────────────
  ttoEnabled:       boolean("tto_enabled"),
  ttoTriggerScore:  integer("tto_trigger_score"),   // 21

  // ── Timeouts ───────────────────────────────────────────────────────────
  timeoutsPerSet:          integer("timeouts_per_set"),         // 1 beach, 2 others
  timeoutDurationSecs:     integer("timeout_duration_secs"),    // 30

  // ── Substitutions ──────────────────────────────────────────────────────
  maxSubsPerSet:     integer("max_subs_per_set"),   // 0 beach, 6 indoor, 4 grass, 4/5 light
  substitutionZoneEnabled: boolean("substitution_zone_enabled"),

  // ── Players per side ───────────────────────────────────────────────────
  playersPerSide:    integer("players_per_side"),   // 2, 4, 5, 6

  // ── Rotation ───────────────────────────────────────────────────────────
  rotationEnabled:       boolean("rotation_enabled"),
  lineupRequired:        boolean("lineup_required"),
  serverPlayerRequired:  boolean("server_player_required"), // track which player serves

  // ── Libero ─────────────────────────────────────────────────────────────
  liberoEnabled:   boolean("libero_enabled"),
  liberoCount:     integer("libero_count"),         // 1 or 2

  // ── Serve clock ────────────────────────────────────────────────────────
  serveClockEnabled: boolean("serve_clock_enabled"),
  serveClockSecs:    integer("serve_clock_secs"),   // 5 beach, 8 indoor/light

  // ── VCS ────────────────────────────────────────────────────────────────
  vcsEnabled:              boolean("vcs_enabled"),
  vcsChallengesPerSet:     integer("vcs_challenges_per_set"),    // 2

  // ── Attack rules ───────────────────────────────────────────────────────
  attackLineM:              numeric("attack_line_m"),            // 3.0 indoor, 2.0 light
  backRowAttackEnabled:     boolean("back_row_attack_enabled"),
  frontZoneArcRequired:     boolean("front_zone_arc_required"), // Light VB only
  jumpServeRestrictionLineM: numeric("jump_serve_restriction_line_m"), // 1.0 for Light VB

  // ── Block ──────────────────────────────────────────────────────────────
  blockCountsAsTeamHit: boolean("block_counts_as_team_hit"), // true=beach/grass, false=indoor/light

  // ── Medical ────────────────────────────────────────────────────────────
  medicalTimeoutSecs:   integer("medical_timeout_secs"),  // 300 (5 min) beach, 180 (3 min) indoor

  // ── Team tablets ───────────────────────────────────────────────────────
  teamTabletEnabled:           boolean("team_tablet_enabled"),
  allowTeamTabletDirectEntry:  boolean("allow_team_tablet_direct_entry"), // auto-approve requests
});
```

---

## teams

```ts
export const teams = pgTable("teams", {
  id:            text("id").primaryKey(),
  competitionId: text("competition_id").notNull().references(() => competitions.id),
  tenantId:      text("tenant_id").notNull().references(() => tenants.id),

  // Name varies by discipline (see spec/01-OVERVIEW.md)
  // Beach: stored as displayName = "Doe J. / Smith A."
  // Indoor: club or country name
  // Grass/Light: custom name
  displayName:   text("display_name").notNull(),

  // For beach: individual player names stored in players table
  // For indoor: club/country info
  countryCode:   text("country_code"),  // ISO 3166-1 alpha-3 (optional)
  clubName:      text("club_name"),

  seed:          integer("seed"),
  poolId:        text("pool_id"),       // for pool-play competitions
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
```

---

## players

```ts
export const players = pgTable("players", {
  id:           text("id").primaryKey(),
  teamId:       text("team_id").notNull().references(() => teams.id),
  tenantId:     text("tenant_id").notNull().references(() => tenants.id),

  firstName:    text("first_name"),
  lastName:     text("last_name"),
  fullName:     text("full_name").notNull(),  // computed or entered directly
  jerseyNumber: integer("jersey_number"),

  isCaptain:    boolean("is_captain").default(false).notNull(),
  isLibero:     boolean("is_libero").default(false).notNull(),  // designated libero on roster

  // role: PLAYER = active roster, BENCH = on bench, STAFF = non-playing
  role:         text("role", { enum: ["PLAYER", "BENCH", "STAFF"] }).default("PLAYER").notNull(),
});
```

---

## matches

```ts
export const matches = pgTable("matches", {
  id:            text("id").primaryKey(),
  competitionId: text("competition_id").notNull().references(() => competitions.id),
  tenantId:      text("tenant_id").notNull().references(() => tenants.id),

  teamAId:       text("team_a_id").notNull().references(() => teams.id),
  teamBId:       text("team_b_id").notNull().references(() => teams.id),
  discipline:    text("discipline", { enum: ["BEACH", "INDOOR", "GRASS", "LIGHT"] }).notNull(),

  status:        text("status", { enum: [
    "SCHEDULED", "WARMUP", "COIN_TOSS", "LIVE", "FINISHED", "ABANDONED"
  ]}).default("SCHEDULED").notNull(),

  // Derived from replaying events — kept here for quick queries/standings
  setsWonA:      integer("sets_won_a").default(0).notNull(),
  setsWonB:      integer("sets_won_b").default(0).notNull(),
  winner:        text("winner", { enum: ["A", "B"] }),

  courtNumber:   integer("court_number"),
  scheduledAt:   timestamp("scheduled_at"),
  startedAt:     timestamp("started_at"),
  finishedAt:    timestamp("finished_at"),

  // Tournament bracket position
  roundName:     text("round_name"),     // "Pool A", "Quarter-final", "Semi-final", "Final"
  matchNumber:   integer("match_number"),

  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
```

---

## events (append-only)

```ts
export const events = pgTable("events", {
  id:           text("id").primaryKey(),           // cuid2
  matchId:      text("match_id").notNull().references(() => matches.id),
  tenantId:     text("tenant_id").notNull().references(() => tenants.id),
  sequence:     integer("sequence").notNull(),     // monotonically increasing per match

  timestamp:    timestamp("timestamp").defaultNow().notNull(),
  eventType:    text("event_type").notNull(),      // e.g. "RALLY_WON_A", "SUBSTITUTION", etc.
  payload:      jsonb("payload").notNull(),        // full typed payload

  // Denormalized for quick display/export (nullable — computed by reducer)
  scoreAfterA:       integer("score_after_a"),
  scoreAfterB:       integer("score_after_b"),
  setNumber:         integer("set_number"),
  serverTeam:        text("server_team", { enum: ["A", "B"] }),
  serverPlayerNumber: integer("server_player_number"),
  sidesAfter:        jsonb("sides_after"),  // { teamA: "LEFT"|"RIGHT", teamB: "LEFT"|"RIGHT" }

  actor:        text("actor", { enum: ["SCORER", "TEAM_A", "TEAM_B", "SYSTEM"] }).notNull(),
  deviceInfo:   text("device_info"),
  notes:        text("notes"),
}, (t) => ({
  matchSeqUniq: unique().on(t.matchId, t.sequence),
  matchIdIdx: index("events_match_id_idx").on(t.matchId),
}));
```

---

## match_sessions (team tablet access tokens)

```ts
export const matchSessions = pgTable("match_sessions", {
  id:         text("id").primaryKey(),   // signed token sent to tablet
  matchId:    text("match_id").notNull().references(() => matches.id),
  tenantId:   text("tenant_id").notNull().references(() => tenants.id),
  team:       text("team", { enum: ["A", "B"] }).notNull(),
  role:       text("role", { enum: ["SCORER", "TEAM_SCORER", "VIEWER"] }).notNull(),
  createdBy:  text("created_by"),        // scorer userId who generated the token
  expiresAt:  timestamp("expires_at").notNull(),
  revokedAt:  timestamp("revoked_at"),
});
```

---

## lineup_submissions (team tablet lineup entry)

Stores the submitted lineup before the scorer confirms it as a LINEUP_CONFIRMED event.

```ts
export const lineupSubmissions = pgTable("lineup_submissions", {
  id:           text("id").primaryKey(),
  matchId:      text("match_id").notNull().references(() => matches.id),
  tenantId:     text("tenant_id").notNull().references(() => tenants.id),
  team:         text("team", { enum: ["A", "B"] }).notNull(),
  setNumber:    integer("set_number").notNull(),
  // Array of playerIds in rotation order (position 1 first, then 2, 3, etc.)
  playerIds:    jsonb("player_ids").notNull(),  // string[]
  liberoId:     text("libero_id"),             // for indoor
  submittedAt:  timestamp("submitted_at").defaultNow().notNull(),
  status:       text("status", { enum: ["PENDING", "CONFIRMED", "REJECTED"] }).default("PENDING").notNull(),
});
```

---

## interrupt_requests (team tablet TO/sub/challenge requests)

```ts
export const interruptRequests = pgTable("interrupt_requests", {
  id:           text("id").primaryKey(),
  matchId:      text("match_id").notNull().references(() => matches.id),
  tenantId:     text("tenant_id").notNull().references(() => tenants.id),
  team:         text("team", { enum: ["A", "B"] }).notNull(),
  requestType:  text("request_type", { enum: [
    "TIMEOUT", "SUBSTITUTION", "CHALLENGE", "MEDICAL"
  ]}).notNull(),
  payload:      jsonb("payload"),   // for SUBSTITUTION: {outPlayerId, inPlayerId}
  status:       text("status", { enum: ["PENDING", "APPROVED", "DENIED"] }).default("PENDING").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  resolvedAt:   timestamp("resolved_at"),
  resolvedBy:   text("resolved_by"),  // scorer userId
});
```

---

## pools and standings

```ts
export const pools = pgTable("pools", {
  id:            text("id").primaryKey(),
  competitionId: text("competition_id").notNull().references(() => competitions.id),
  tenantId:      text("tenant_id").notNull().references(() => tenants.id),
  name:          text("name").notNull(),  // "Pool A", "Pool B", etc.
  roundName:     text("round_name"),      // "Preliminary", "Semi-final"
});

export const poolTeams = pgTable("pool_teams", {
  poolId:  text("pool_id").notNull().references(() => pools.id),
  teamId:  text("team_id").notNull().references(() => teams.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.poolId, t.teamId] }),
}));
```

Standings are computed on-the-fly from `matches` table (no caching needed at this scale).

---

## CSV import tables

All CSV imports are idempotent (upsert). Import log:

```ts
export const csvImports = pgTable("csv_imports", {
  id:          text("id").primaryKey(),
  tenantId:    text("tenant_id").notNull().references(() => tenants.id),
  importType:  text("import_type", { enum: ["TEAMS", "PLAYERS", "SCHEDULE", "RESULTS"] }).notNull(),
  filename:    text("filename"),
  rowsOk:      integer("rows_ok").default(0).notNull(),
  rowsError:   integer("rows_error").default(0).notNull(),
  errors:      jsonb("errors"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  createdBy:   text("created_by"),
});
```

---

## Database conventions

- All IDs: `cuid2` (via `@paralleldrive/cuid2`), stored as `text`
- Timestamps: `timestamp` (no timezone, UTC everywhere)
- JSON columns: `jsonb` (indexed, fast)
- Every table has `tenantId` — RLS enforced at API layer (not Postgres RLS, for simplicity)
- Foreign keys: all declared, enforced in production
- Migrations: Drizzle Kit (`drizzle-kit push` for development, `drizzle-kit generate` + apply against Supabase PostgreSQL for production)
