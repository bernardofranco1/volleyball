CREATE TABLE "vis_first_servers" (
	"match_no" integer NOT NULL,
	"set_no" integer NOT NULL,
	"side" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vis_first_servers_match_no_set_no_pk" PRIMARY KEY("match_no","set_no")
);
--> statement-breakpoint
ALTER TABLE "vis_first_servers" ENABLE ROW LEVEL SECURITY;