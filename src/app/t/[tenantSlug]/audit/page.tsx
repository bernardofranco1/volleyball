import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { listAudit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { t } = await getT();
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
          <h1 className="text-2xl font-semibold tracking-tight">{t("audit.title")}</h1>
          <p className="mt-1 text-sm text-score-dim">
            {t("audit.subtitle", { tenant: ctx.tenant.name })}
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/settings`} className={ui.btnSecondary}>
          {t("common.backToSettings")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className={`${ui.card} text-sm text-score-dim`}>
          {t("audit.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse">
            <thead className="bg-surface-raised">
              <tr>
                <th className={ui.th}>{t("audit.when")}</th>
                <th className={ui.th}>{t("match.thActor")}</th>
                <th className={ui.th}>{t("audit.action")}</th>
                <th className={ui.th}>{t("audit.detail")}</th>
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
