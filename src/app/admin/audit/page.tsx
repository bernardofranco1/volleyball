import Link from "next/link";
import { requireGlobalAdmin } from "@/lib/authz";
import { listPlatformAudit } from "@/lib/audit";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// Platform audit trail (spec/26 §9): events that belong to no tenant —
// impersonation start/stop, global-admin flag changes, password resets,
// account deletions. Tenant-scoped activity stays on /t/{slug}/audit.
// English-only, like the rest of the console.
export default async function AdminAuditPage() {
  await requireGlobalAdmin("/admin/audit");
  const rows = await listPlatformAudit(200);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform audit</h1>
          <p className="mt-1 text-sm text-score-dim">
            Actions that affect the platform itself rather than a single tenant:
            who signed in as whom, global-admin changes, password resets and
            account deletions. Tenant activity lives on each tenant’s own audit
            page.
          </p>
        </div>
        <Link href="/admin/access" className={ui.btnSecondary}>
          Back to People
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className={`${ui.card} text-sm text-score-dim`}>
          Nothing recorded yet.
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
              {rows.map((r) => {
                const impersonating = (r.metadata as { impersonating?: string } | null)
                  ?.impersonating;
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className={`${ui.td} whitespace-nowrap text-score-dim`}>
                      {new Date(r.createdAt).toUTCString().slice(5, 25)}
                    </td>
                    <td className={`${ui.td} text-score-dim`}>
                      {r.actorEmail ?? r.actorUserId?.slice(0, 8) ?? "—"}
                      {impersonating && (
                        <span
                          className="ml-2 rounded-full border border-amber-400/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400"
                          title={`Acting as ${impersonating}`}
                        >
                          as {impersonating.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className={`${ui.td} font-mono text-xs`}>{r.action}</td>
                    <td className={ui.td}>{r.summary ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
