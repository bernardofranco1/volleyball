ALTER TABLE "tournament_config" ADD COLUMN IF NOT EXISTS "timeouts_per_set_tiebreak" integer;--> statement-breakpoint
ALTER TABLE "tournament_config" ADD COLUMN IF NOT EXISTS "set_break_durations_secs" jsonb;
