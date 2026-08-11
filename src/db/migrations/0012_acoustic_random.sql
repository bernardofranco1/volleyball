DROP INDEX "players_team_person_uq";--> statement-breakpoint
ALTER TABLE "match_officials" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "players_team_person_uq" ON "players" USING btree ("team_id","person_id");--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "last_name";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "full_name";