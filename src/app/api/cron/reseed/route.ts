// Daily demo reseed (Vercel Cron). Wipes the demo tenant's competitions and
// rebuilds four dated ones so the database sees fresh write activity every
// morning (keeps the Supabase project active + presents dated demo content).
//
// Scheduled from vercel.json. Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` on cron invocations when CRON_SECRET is
// set — we require it so the endpoint isn't publicly triggerable.
import type { NextRequest } from "next/server";
import { runDemoSeed } from "@/lib/demo-seed";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: refuse to run an unauthenticated destructive reseed.
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDemoSeed();
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    captureError(err, { scope: "cron-reseed" });
    return Response.json({ error: "Reseed failed" }, { status: 500 });
  }
}
