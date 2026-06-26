// Health check (Phase 11) for uptime monitoring. Public, unauthenticated; pings
// the DB and returns 200 when healthy, 503 when the DB is unreachable. Point an
// uptime monitor (UptimeRobot, BetterStack, Pingdom, …) at GET /api/health.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return Response.json(
    {
      status: dbOk ? "ok" : "degraded",
      db: dbOk ? "ok" : "down",
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
