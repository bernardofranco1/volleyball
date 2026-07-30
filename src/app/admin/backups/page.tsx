import { requireGlobalAdmin } from "@/lib/authz";
import { listBackupRuns } from "@/lib/backup";
import { listAllTenants } from "@/lib/tenant-admin";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AdminBackupsPage() {
  await requireGlobalAdmin("/admin/backups");
  const [runs, tenants] = await Promise.all([listBackupRuns(100), listAllTenants()]);
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
        <p className="mt-1 text-sm text-score-dim">
          Daily fulls run at 03:00 UTC; incrementals fire when a match changes
          status or competitions/matches are created (per-competition, 5-min
          debounce). Retention: 30 daily fulls per tenant + incrementals since
          the oldest kept full. Trigger a manual backup from a tenant&apos;s page.
        </p>
      </div>

      <div className={ui.card}>
        {runs.length === 0 ? (
          <p className="text-sm text-score-dim">No backup runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={ui.th}>When (UTC)</th>
                  <th className={ui.th}>Tenant</th>
                  <th className={ui.th}>Kind</th>
                  <th className={ui.th}>Trigger</th>
                  <th className={ui.th}>Status</th>
                  <th className={ui.th}>Size</th>
                  <th className={ui.th}></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((b) => (
                  <tr key={b.id} className="border-b border-border/50">
                    <td className={ui.td}>
                      {b.startedAt.toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td className={ui.td}>{tenantName.get(b.tenantId) ?? b.tenantId}</td>
                    <td className={ui.td}>{b.kind}</td>
                    <td className={ui.td}>{b.trigger}</td>
                    <td className={ui.td}>
                      <span
                        className={
                          b.status === "OK"
                            ? "text-emerald-400"
                            : b.status === "FAILED"
                              ? "text-red-400"
                              : "text-amber-400"
                        }
                        title={b.error ?? undefined}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className={ui.td}>
                      {b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} kB` : "—"}
                    </td>
                    <td className={ui.td}>
                      {b.status === "OK" && b.objectPath && (
                        <a
                          href={`/api/admin/backups/${b.id}/download`}
                          className="text-primary underline"
                        >
                          Download
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
