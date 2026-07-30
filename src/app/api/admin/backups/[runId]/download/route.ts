// Signed-URL redirect for a backup object (spec/23 §7.5). Global admin only —
// the bucket itself is private; this is the only read path the app exposes.
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { backupRuns } from "@/db/schema";
import { getCurrentUser, isGlobalAdmin } from "@/lib/authz";
import { backupDownloadUrl } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isGlobalAdmin(user.id)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const { runId } = await params;
  const run = (
    await db.select().from(backupRuns).where(eq(backupRuns.id, runId)).limit(1)
  )[0];
  if (!run || run.status !== "OK" || !run.objectPath)
    return Response.json({ error: "Not found" }, { status: 404 });

  const url = await backupDownloadUrl(run.objectPath);
  if (!url)
    return Response.json({ error: "Could not sign URL" }, { status: 500 });
  return NextResponse.redirect(url, 302);
}
