import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { listAudit } from "@/lib/audit";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ["TENANT_ADMIN"],
    `/t/${tenantSlug}/audit`,
  );
  const rows = await listAudit(ctx.tenant.id, 200);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-sm text-score-dim">
            Recent administrative changes for {ctx.tenant.name}.
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/settings`} className={ui.btnSecondary}>
          ← Settings
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className={`${ui.card} text-sm text-score-dim`}>
          No audit entries yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse">
            <thead className="bg-surface-raised">
              <tr>
                <th className={ui.th}>When (UTC)</th>
                <th className={ui.th}>Actor</th>
                <th className={ui.th}>Action</th>
                <th className={ui.th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className={`${ui.td} whitespace-nowrap text-score-dim`}>
                    {new Date(r.createdAt).toUTCString().slice(5, 25)}
                  </td>
                  <td className={`${ui.td} text-score-dim`}>
                    {r.actorEmail ?? r.actorUserId?.slice(0, 8) ?? "—"}
                  </td>
                  <td className={`${ui.td} font-mono text-xs`}>{r.action}</td>
                  <td className={ui.td}>{r.summary ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
