ALTER TABLE "people" ADD COLUMN "jersey_name" text;--> statement-breakpoint
-- Seed the shirt label from the data we have. The surname is what the boards and
-- courts were already DISPLAYING (they derived it from the full name with a
-- string heuristic), so this makes the stored value match what was on screen
-- rather than inventing anything; rows with no surname keep their previous
-- label. Federations conventionally put the surname on the shirt, so this is
-- also the right default going forward — and it is editable per person.
UPDATE "people" SET "jersey_name" = coalesce("last_name", "display_name")
  WHERE "jersey_name" IS NULL;
