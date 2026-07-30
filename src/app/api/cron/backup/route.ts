// Daily backup cron (spec/23 §7.3). Scheduled from vercel.json at 03:00 UTC —
// deliberately BEFORE the 05:00 demo reseed, so the Test tenant's day is
// captured pre-wipe. Per tenant: FULL export → retention pruning; then the
// grace-expired soft-deleted tenants are purged (§3.4).
//
// Time budget: tenants are processed sequentially with a guard; whatever
// doesn't fit is recorded as a FAILED run ("time budget") so a missed backup
// is visible in the console, never silently absent.
import type { NextRequest } from "next/server";
import { runBackup, pruneBackups } from "@/lib/backup";
import { listLiveTenantIds, purgeExpiredTenants } from "@/lib/tenant-admin";
import { db } from "@/db";
import { backupRuns } from "@/db/schema";
import { captureError } from "@/lib/observability";
import { newId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Leave headroom for the response + purge inside maxDuration.
const TIME_BUDGET_MS = 50_000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const results: Record<string, string> = {};
  try {
    const tenants = await listLiveTenantIds();
    let outOfTime = false;

    for (const t of tenants) {
      if (outOfTime || Date.now() - startedAt > TIME_BUDGET_MS) {
        outOfTime = true;
        // Visible failure instead of a silent skip.
        await db.insert(backupRuns).values({
          id: newId("bkp"),
          tenantId: t.id,
          kind: "FULL",
          trigger: "CRON",
          status: "FAILED",
          error: "time budget exhausted — raise maxDuration or split the cron",
          finishedAt: new Date(),
        });
        results[t.slug] = "skipped (time budget)";
        continue;
      }

      const r = await runBackup({ tenantId: t.id, kind: "FULL", trigger: "CRON" });
      results[t.slug] = r.ok ? `ok (${r.sizeBytes} bytes)` : `failed: ${r.error}`;
      if (r.ok) {
        try {
          await pruneBackups(t.id);
        } catch (err) {
          captureError(err, { scope: "backup-prune", tenantId: t.id });
          results[t.slug] += " (prune failed)";
        }
      }
    }

    const purged = await purgeExpiredTenants();
    return Response.json({ ok: !outOfTime, results, purged });
  } catch (err) {
    captureError(err, { scope: "cron-backup" });
    return Response.json({ error: "Backup cron failed", results }, { status: 500 });
  }
}
