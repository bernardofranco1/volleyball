import { redirect } from "next/navigation";
import { getCurrentUser, isGlobalAdmin, type Role } from "@/lib/authz";
import { getUserTenants } from "@/lib/tenant";
import { tenantUrl } from "@/lib/subdomain";
import { ROLE_LABEL } from "@/lib/roles";
import { getT } from "@/lib/i18n/server";
import { ui } from "@/components/admin/styles";

// Post-login tenant picker for users who belong to several tenants
// (spec/23 §4). Single-tenant users and global admins never land here.
export const dynamic = "force-dynamic";

const ROLE_RANK: Record<Role, number> = {
  TENANT_ADMIN: 4,
  COMPETITION_ADMIN: 3,
  SCORER: 2,
  VIEWER: 1,
};

export default async function SelectTenantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=%2Fselect-tenant");
  if (await isGlobalAdmin(user.id)) redirect("/admin");

  const tenants = await getUserTenants(user.id);
  if (tenants.length === 1) redirect(tenantUrl(tenants[0], "/dashboard"));

  const { t } = await getT();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {t("selectTenant.title")}
      </h1>
      <p className="mb-8 text-sm text-score-dim">{t("selectTenant.subtitle")}</p>

      {tenants.length === 0 ? (
        <p className={`${ui.card} text-sm text-score-dim`}>
          {t("selectTenant.none")}
        </p>
      ) : (
        <div className="space-y-3">
          {tenants.map((tn) => {
            const top = (tn.roles as Role[]).reduce(
              (a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a),
              "VIEWER" as Role,
            );
            return (
              <a
                key={tn.id}
                href={tenantUrl(tn, "/dashboard")}
                className={`${ui.card} flex items-center gap-4 transition-colors hover:border-primary`}
              >
                {tn.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tn.logoUrl}
                    alt=""
                    className="h-10 w-10 rounded object-contain"
                  />
                ) : (
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-base font-bold text-primary-fg"
                    aria-hidden
                  >
                    {(tn.title ?? tn.name).charAt(0)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {tn.title ?? tn.name}
                  </span>
                  <span className="block text-sm text-score-dim">
                    {ROLE_LABEL[top]}
                  </span>
                </span>
                <span className="text-score-dim" aria-hidden>
                  →
                </span>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
