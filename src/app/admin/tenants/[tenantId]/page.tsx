import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGlobalAdmin } from "@/lib/authz";
import { getTenantById, DELETE_GRACE_DAYS } from "@/lib/tenant-admin";
import { listTenantBackupRuns, TEST_TENANT_SLUG } from "@/lib/backup";
import { listMembers } from "@/lib/access";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { TenantConfigForm } from "@/components/admin/TenantConfigForm";
import { AdminTenantCapabilityForm } from "@/components/admin/AdminTenantCapabilityForm";
import { TenantDangerZone } from "@/components/admin/TenantDangerZone";
import { BackupNowButton } from "@/components/admin/BackupNowButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AdminTenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requireGlobalAdmin("/admin");
  const { tenantId } = await params;
  const { created } = await searchParams;
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();

  const [members, backups] = await Promise.all([
    listMembers(tenant.id),
    listTenantBackupRuns(tenant.id, 10),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="mt-1 text-sm text-score-dim">
            /t/{tenant.slug}
            {tenant.subdomain ? ` · ${tenant.subdomain}.*` : ""}
          </p>
        </div>
        <Link href="/admin" className={ui.btnSecondary}>
          ← Tenants
        </Link>
      </div>

      {created && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-emerald-500/40 px-4 py-3 text-sm text-emerald-400"
        >
          Tenant created. Invite its first admin from the{" "}
          <Link href={`/t/${tenant.slug}/access`} className="underline">
            Access page
          </Link>
          , then hand them the keys.
        </p>
      )}

      <div className="space-y-10">
        <TenantConfigForm tenant={tenant} />

        <AdminTenantCapabilityForm
          tenantId={tenant.id}
          config={tenant.config}
        />

        <section aria-labelledby="admin-branding">
          <h2
            id="admin-branding"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            Branding
          </h2>
          <BrandingForm
            tenantSlug={tenant.slug}
            branding={tenant.branding}
            enabledDisciplines={tenant.config.enabledDisciplines}
          />
        </section>

        <section aria-labelledby="admin-members">
          <h2
            id="admin-members"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            Members
          </h2>
          <Link
            href={`/t/${tenant.slug}/access`}
            className={`${ui.card} flex items-center justify-between transition-colors hover:border-primary`}
          >
            <span>
              <span className="font-medium">
                {members.length} member{members.length === 1 ? "" : "s"}
              </span>
              <span className="mt-1 block text-sm text-score-dim">
                Manage on the tenant&apos;s Access page (invite, roles, revoke).
              </span>
            </span>
            <span className="text-score-dim">→</span>
          </Link>
        </section>

        <section aria-labelledby="admin-backups">
          <h2
            id="admin-backups"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            Backups
          </h2>
          <div className={ui.card}>
            <div className="mb-4">
              <BackupNowButton tenantId={tenant.id} />
            </div>
            {backups.length === 0 ? (
              <p className="text-sm text-score-dim">No backups yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={ui.th}>When</th>
                      <th className={ui.th}>Kind</th>
                      <th className={ui.th}>Status</th>
                      <th className={ui.th}>Size</th>
                      <th className={ui.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.id} className="border-b border-border/50">
                        <td className={ui.td}>
                          {b.startedAt.toISOString().replace("T", " ").slice(0, 16)}
                        </td>
                        <td className={ui.td}>
                          {b.kind}
                          <span className="text-score-dim"> · {b.trigger}</span>
                        </td>
                        <td className={ui.td}>
                          <span
                            className={
                              b.status === "OK"
                                ? "text-emerald-400"
                                : b.status === "FAILED"
                                  ? "text-red-400"
                                  : "text-amber-400"
                            }
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
        </section>

        <TenantDangerZone
          tenant={{
            id: tenant.id,
            name: tenant.name,
            deletedAt: tenant.deletedAt?.toISOString() ?? null,
            isTestTenant: tenant.slug === TEST_TENANT_SLUG,
          }}
          graceDays={DELETE_GRACE_DAYS}
        />
      </div>
    </main>
  );
}
