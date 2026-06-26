import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit runs outside Next.js, so load the local env file explicitly.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // For migrations/push, point DATABASE_URL at the Supabase *direct*
    // connection (port 5432), not the transaction pooler.
    url: process.env.DATABASE_URL!,
  },
});
