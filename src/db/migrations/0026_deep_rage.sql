ALTER TABLE "competitions" ADD COLUMN "vs_championship_id" integer;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "board_source" text DEFAULT 'vis' NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "project" text DEFAULT 'scoring' NOT NULL;