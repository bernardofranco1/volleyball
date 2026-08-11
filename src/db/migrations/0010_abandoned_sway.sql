CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"gender" text,
	"birthdate" date,
	"federation_code" text,
	"height_cm" integer,
	"weight_kg" integer,
	"position" text,
	"spike_reach_cm" integer,
	"block_reach_cm" integer,
	"handedness" text,
	"photo_url" text,
	"referee_level" text,
	"vis_person_no" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "person_roles_person_id_role_unique" UNIQUE("person_id","role")
);
--> statement-breakpoint
ALTER TABLE "person_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_staff" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"function" text NOT NULL,
	CONSTRAINT "team_staff_function" UNIQUE("team_id","function")
);
--> statement-breakpoint
ALTER TABLE "team_staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_officials" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_tenant_idx" ON "people" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "people_tenant_name_idx" ON "people" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_vis_uq" ON "people" USING btree ("tenant_id","vis_person_no") WHERE "people"."vis_person_no" is not null;--> statement-breakpoint
CREATE INDEX "person_roles_tenant_role_idx" ON "person_roles" USING btree ("tenant_id","role");--> statement-breakpoint
ALTER TABLE "match_officials" ADD CONSTRAINT "match_officials_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;