import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { listMembers, adminCount } from "@/lib/access";
import { setMemberRole, removeMember } from "@/lib/access-actions";
import { ROLE_LABEL, ROLE_HINT, ASSIGNABLE_ROLES } from "@/lib/roles";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddMemberForm } from "@/components/admin/AddMemberForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function AccessPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { t } = await getT();
  // Access management is admin-only.
  const ctx = await requireRole(tenantSlug, ["TENANT_ADMIN"], `/t/${tenantSlug}/access`);

  const [members, admins] = await Promise.all([
    listMembers(ctx.tenant.id),
    adminCount(ctx.tenant.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("access.title")}</h1>
          <p className="mt-1 text-sm text-score-dim">
            {t("access.subtitle", { tenant: ctx.tenant.name })}
          </p>
        </div>
        <Link href={`/t/${tenantSlug}/settings`} className={ui.btnSecondary}>
          {t("common.backToSettings")}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-score-dim">
              {t("access.people", { count: members.length })}
            </div>
            <ul className="divide-y divide-border">
              {members.map((m) => {
                const isSelf = m.userId === ctx.user.id;
                const isLastAdmin = m.role === "TENANT_ADMIN" && admins <= 1;
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.email}
                        {isSelf ? <span className="text-score-dim"> {t("access.you")}</span> : null}
                      </div>
                      {m.name ? (
                        <div className="truncate text-xs text-score-dim">{m.name}</div>
                      ) : null}
                    </div>

                    {isLastAdmin ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-score-dim">
                        {ROLE_LABEL[m.role]} · {t("access.lastAdmin")}
                      </span>
                    ) : (
                      <ActionForm
                        action={setMemberRole}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <label className="sr-only" htmlFor={`role-${m.userId}`}>
                          {t("access.roleFor", { email: m.email })}
                        </label>
                        <select
                          id={`role-${m.userId}`}
                          name="role"
                          defaultValue={m.role}
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <SubmitButton variant="secondary" pendingLabel="…">
                          {t("common.save")}
                        </SubmitButton>
                      </ActionForm>
                    )}

                    {!isSelf && !isLastAdmin ? (
                      <ActionForm
                        action={removeMember}
                        confirm={t("access.removeConfirm", { email: m.email, tenant: ctx.tenant.name })}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <button
                          type="submit"
                          className="text-xs text-score-dim hover:text-red-400"
                        >
                          {t("common.remove")}
                        </button>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Role legend */}
          <div className={`${ui.card} mt-4 text-xs`}>
            <p className="mb-2 font-medium text-foreground">{t("access.roles")}</p>
            <ul className="space-y-1 text-score-dim">
              {ASSIGNABLE_ROLES.map((r) => (
                <li key={r}>
                  <span className="font-medium text-foreground">{ROLE_LABEL[r]}</span> —{" "}
                  {ROLE_HINT[r]}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-score-dim">
              {t("access.pinNote")}
            </p>
          </div>
        </div>

        <AddMemberForm tenantSlug={tenantSlug} />
      </div>
    </main>
  );
}
