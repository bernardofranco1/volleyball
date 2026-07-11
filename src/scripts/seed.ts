// Full demo seed (spec/13) — CLI entrypoint. The logic lives in
// src/lib/demo-seed.ts so the daily cron route can reuse it.
//
// Wipes the demo tenant's competitions and rebuilds four dated ones (one per
// discipline), each with a finished + a live match, through the real engine.
// Idempotent. Run: npx tsx --env-file=.env.local src/scripts/seed.ts
import { runDemoSeed } from "@/lib/demo-seed";

runDemoSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
