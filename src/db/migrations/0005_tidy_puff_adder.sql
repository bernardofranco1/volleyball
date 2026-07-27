CREATE TABLE "match_officials" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"level" text,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "match_officials_role" UNIQUE("match_id","role")
);
--> statement-breakpoint
ALTER TABLE "match_officials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "match_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_player_id" text,
	"strokes" jsonb,
	"intent" text DEFAULT 'ACCEPT' NOT NULL,
	"remarks" text,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"signed_sequence" integer NOT NULL,
	"result_digest" text NOT NULL,
	"captured_by" text,
	"device_info" text,
	"invalidated_at" timestamp,
	"invalidated_reason" text
);
--> statement-breakpoint
ALTER TABLE "match_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "confirmed_via" text;--> statement-breakpoint
ALTER TABLE "tournament_config" ADD COLUMN "result_signatures" text;--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_signatures" ADD CONSTRAINT "match_signatures_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_signatures" ADD CONSTRAINT "match_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_signatures" ADD CONSTRAINT "match_signatures_signer_player_id_players_id_fk" FOREIGN KEY ("signer_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_signatures_match_idx" ON "match_signatures" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_signatures_live_role" ON "match_signatures" USING btree ("match_id","role") WHERE "match_signatures"."invalidated_at" is null;