CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"summary" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_branding" (
	"competition_id" text PRIMARY KEY NOT NULL,
	"bg_color" text,
	"line_color" text,
	"accent_color" text,
	"font_color" text,
	"font_family" text,
	"logo_url" text
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"discipline" text NOT NULL,
	"gender" text DEFAULT 'UNSPECIFIED',
	"start_date" date,
	"end_date" date,
	"venue" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csv_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"import_type" text NOT NULL,
	"filename" text,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_error" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"score_after_a" integer,
	"score_after_b" integer,
	"set_number" integer,
	"server_team" text,
	"server_player_number" integer,
	"sides_after" jsonb,
	"actor" text NOT NULL,
	"device_info" text,
	"notes" text,
	CONSTRAINT "events_match_id_sequence_unique" UNIQUE("match_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "interrupt_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"team" text NOT NULL,
	"request_type" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "match_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"team" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"team_a_id" text NOT NULL,
	"team_b_id" text NOT NULL,
	"discipline" text NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"sets_won_a" integer DEFAULT 0 NOT NULL,
	"sets_won_b" integer DEFAULT 0 NOT NULL,
	"winner" text,
	"state_snapshot" jsonb,
	"snapshot_sequence" integer DEFAULT 0 NOT NULL,
	"court_number" integer,
	"scheduled_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"round_name" text,
	"match_number" integer,
	"group_name" text,
	"phase_number" integer,
	"phase_name" text,
	"scorer_pin" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"full_name" text NOT NULL,
	"jersey_number" integer,
	"is_captain" boolean DEFAULT false NOT NULL,
	"is_libero" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'PLAYER' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_teams" (
	"pool_id" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "pool_teams_pool_id_team_id_pk" PRIMARY KEY("pool_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"round_name" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"display_name" text NOT NULL,
	"country_code" text,
	"club_name" text,
	"seed" integer,
	"color" text,
	"pool_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_billing" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"logo_url" text,
	"primary_color" text DEFAULT '#0066cc',
	"secondary_color" text DEFAULT '#ffffff',
	"font_family" text,
	"court_color_overrides" jsonb
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tournament_config" (
	"competition_id" text PRIMARY KEY NOT NULL,
	"best_of" integer,
	"set_score" integer,
	"set_score_tiebreak" integer,
	"two_point_lead" boolean,
	"side_switch_enabled" boolean,
	"side_switch_every" integer,
	"side_switch_tiebreak_every" integer,
	"side_switch_between_sets_only" boolean,
	"tto_enabled" boolean,
	"tto_trigger_score" integer,
	"timeouts_per_set" integer,
	"timeout_duration_secs" integer,
	"max_subs_per_set" integer,
	"substitution_zone_enabled" boolean,
	"players_per_side" integer,
	"rotation_enabled" boolean,
	"lineup_required" boolean,
	"server_player_required" boolean,
	"libero_enabled" boolean,
	"libero_count" integer,
	"serve_clock_enabled" boolean,
	"serve_clock_secs" integer,
	"vcs_enabled" boolean,
	"vcs_challenges_per_set" integer,
	"attack_line_m" numeric,
	"back_row_attack_enabled" boolean,
	"front_zone_arc_required" boolean,
	"jump_serve_restriction_line_m" numeric,
	"block_counts_as_team_hit" boolean,
	"medical_timeout_secs" integer,
	"team_tablet_enabled" boolean,
	"allow_team_tablet_direct_entry" boolean
);
--> statement-breakpoint
CREATE TABLE "user_tenant_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "user_tenant_roles_user_id_tenant_id_role_unique" UNIQUE("user_id","tenant_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_branding" ADD CONSTRAINT "competition_branding_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interrupt_requests" ADD CONSTRAINT "interrupt_requests_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interrupt_requests" ADD CONSTRAINT "interrupt_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sessions" ADD CONSTRAINT "match_sessions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_sessions" ADD CONSTRAINT "match_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_teams" ADD CONSTRAINT "pool_teams_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_teams" ADD CONSTRAINT "pool_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_config" ADD CONSTRAINT "tournament_config_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenant_roles" ADD CONSTRAINT "user_tenant_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "competitions_tenant_idx" ON "competitions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "csv_imports_tenant_idx" ON "csv_imports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "interrupt_requests_match_status_idx" ON "interrupt_requests" USING btree ("match_id","status");--> statement-breakpoint
CREATE INDEX "match_sessions_match_idx" ON "match_sessions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "matches_competition_status_idx" ON "matches" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "matches_tenant_sched_idx" ON "matches" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "matches_team_a_idx" ON "matches" USING btree ("team_a_id");--> statement-breakpoint
CREATE INDEX "matches_team_b_idx" ON "matches" USING btree ("team_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_knockout_slot" ON "matches" USING btree ("competition_id","round_name","match_number") WHERE "matches"."round_name" in ('Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinal', 'Semifinal', 'Final', '3rd Place');--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_jersey_uq" ON "players" USING btree ("team_id","jersey_number");--> statement-breakpoint
CREATE INDEX "pools_competition_idx" ON "pools" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "teams_competition_idx" ON "teams" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "user_tenant_roles_tenant_idx" ON "user_tenant_roles" USING btree ("tenant_id");