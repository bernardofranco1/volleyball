CREATE TABLE "backup_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"scope" jsonb,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"object_path" text,
	"size_bytes" integer,
	"row_counts" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "backup_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "subdomain" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_global_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_tenant_started_idx" ON "backup_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain");