CREATE TABLE "vs_match_links" (
	"match_no" integer PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"vis_tournament_no" integer NOT NULL,
	"vs_championship_id" integer NOT NULL,
	"vs_championship_match_id" integer NOT NULL,
	"vs_home_team_id" integer,
	"vs_guest_team_id" integer,
	"vis_code_a" text,
	"vis_code_b" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vs_match_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "vs_match_links_tournament_idx" ON "vs_match_links" USING btree ("vis_tournament_no");