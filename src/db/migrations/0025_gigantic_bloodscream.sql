CREATE TABLE "vis_rotation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"match_no" integer NOT NULL,
	"set_no" integer NOT NULL,
	"rally_no" integer NOT NULL,
	"team" text NOT NULL,
	"first_server" text,
	"confidence" text,
	"expected_turns" integer,
	"feed_six" text,
	"model_six" text,
	"kind" text NOT NULL,
	"score_a" integer,
	"score_b" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vis_rotation_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "vis_rotation_log_once" ON "vis_rotation_log" USING btree ("match_no","set_no","rally_no","team","kind");--> statement-breakpoint
CREATE INDEX "vis_rotation_log_recent" ON "vis_rotation_log" USING btree ("created_at");