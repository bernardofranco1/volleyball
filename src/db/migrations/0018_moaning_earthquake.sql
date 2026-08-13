CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"sha" text NOT NULL,
	"message" text,
	"branch" text,
	"previous_deployment_id" text,
	"migrations_in_repo" integer,
	"migrations_applied" integer,
	"action" text DEFAULT 'PROMOTE' NOT NULL,
	"promoted_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "releases_created_idx" ON "releases" USING btree ("created_at");