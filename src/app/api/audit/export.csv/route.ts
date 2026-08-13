// Audit-log CSV export, matching whatever the viewer is currently filtered to.
// TENANT_ADMIN only — the same gate as the viewer itself, since the log names
// who did what and when.
import type { NextRequest } from "next/server";
import { getAuthContext, hasRole } from "@/lib/authz";
import { listAuditPage } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(v: string | number | null): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection — summaries carry user-entered
  // names and rewind reasons.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantSlug = sp.get("tenant");
  if (!tenantSlug) return new Response("tenant required", { status: 400 });

  const ctx = await getAuthContext(tenantSlug);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!hasRole(ctx.roles, ["TENANT_ADMIN"]))
    return new Response("Forbidden", { status: 403 });

  const { rows } = await listAuditPage(ctx.tenant.id, {
    q: sp.get("q") ?? undefined,
    action: sp.get("action") ?? undefined,
    paginate: false,
  });

  const lines = [
    ["timestamp", "actor", "action", "entityType", "entityId", "summary"].join(","),
  ];
  for (const r of rows) {
    lines.push(
      [
        new Date(r.createdAt).toISOString(),
        r.actorEmail ?? r.actorUserId ?? "",
        r.action,
        r.entityType,
        r.entityId,
        r.summary,
      ]
        .map(cell)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${tenantSlug}-audit.csv"`,
      "cache-control": "no-store",
    },
  });
}
