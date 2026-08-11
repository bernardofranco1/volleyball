CREATE TABLE "tenant_config" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"enabled_disciplines" jsonb,
	"enabled_report_types" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_config" ADD CONSTRAINT "tenant_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;