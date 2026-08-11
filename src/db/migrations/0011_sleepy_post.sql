ALTER TABLE "people" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_email_uq" ON "people" USING btree ("tenant_id","email") WHERE "people"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_user_uq" ON "people" USING btree ("tenant_id","user_id") WHERE "people"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "people_tenant_birthdate_idx" ON "people" USING btree ("tenant_id","birthdate");--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_person_uq" ON "players" USING btree ("team_id","person_id") WHERE "players"."person_id" is not null;