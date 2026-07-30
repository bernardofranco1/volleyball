import Link from "next/link";
import { requireGlobalAdmin } from "@/lib/authz";
import { listAllTenants } from "@/lib/tenant-admin";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

/** Age badge for the last successful FULL backup: red when overdue (>26 h). */
function backupBadge(last: Date | null) {
  if (!last)
    return <span className="text-xs text-red-400">never backed up</span>;
  const hours = (Date.now() - last.getTime()) / 3_600_000;
  const label =
    hours < 1.5 ? "backed up <1 h ago" : `backed up ${Math.round(hours)} h ago`;
  return (
    <span className={`text-xs ${hours > 26 ? "text-red-400" : "text-score-dim"}`}>
      {label}
    </span>
  );
}

export default async function AdminTenantsPage() {
  await requireGlobalAdmin("/admin");
  const tenants = await listAllTenants();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="mt-1 text-sm text-score-dim">
            Each tenant is an isolated organisation with its own branding,
            members, competitions and backups.
          </p>
        </div>
        <Link href="/admin/tenants/new" className={ui.btnPrimary}>
          + New tenant
        </Link>
      </div>

      <div className="space-y-3">
        {tenants.map((t) => (
          <div
            key={t.id}
            className={`${ui.card} flex flex-wrap items-center justify-between gap-4 ${
              t.deletedAt ? "opacity-60" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              {t.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
              ) : (
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg"
                  aria-hidden
                >
                  {t.name.charAt(0)}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{t.name}</span>
                  {t.title && (
                    <span className="truncate text-xs text-score-dim">
                      “{t.title}”
                    </span>
                  )}
                  {t.deletedAt && (
                    <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-[10px] font-medium uppercase text-red-400">
                      deleted
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-score-dim">
                  <span>/t/{t.slug}</span>
                  {t.subdomain && <span>{t.subdomain}.*</span>}
                  <span>
                    {t.competitionCount} competitions · {t.matchCount} matches ·{" "}
                    {t.memberCount} members
                  </span>
                  {backupBadge(t.lastFullBackupAt)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!t.deletedAt && (
                <Link href={`/t/${t.slug}/dashboard`} className={ui.btnSecondary}>
                  Open
                </Link>
              )}
              <Link href={`/admin/tenants/${t.id}`} className={ui.btnSecondary}>
                Configure
              </Link>
            </div>
          </div>
        ))}
        {tenants.length === 0 && (
          <p className="text-sm text-score-dim">No tenants yet.</p>
        )}
      </div>
    </main>
  );
}
