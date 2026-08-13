import { requireRole } from "@/lib/authz";
import { listMembers, adminCount } from "@/lib/access";
import { setMemberRole, removeMember } from "@/lib/access-actions";
import { ROLE_LABEL, ROLE_HINT, ASSIGNABLE_ROLES } from "@/lib/roles";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddMemberForm } from "@/components/admin/AddMemberForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Drawer } from "@/components/ui/Drawer";
import { Page, PageHeader, Panel } from "@/components/ui/Page";

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
    <Page>
      <PageHeader
        title={t("access.title")}
        meta={t("access.subtitle", { tenant: ctx.tenant.name })}
        actions={
          <Drawer label={t("access.invite")} variant="primary" width="lg">
            <AddMemberForm tenantSlug={tenantSlug} />
          </Drawer>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border bg-surface-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-score-dim">
            {t("access.people", { count: members.length })}
          </div>
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const isSelf = m.userId === ctx.user.id;
              const isLastAdmin = m.role === "TENANT_ADMIN" && admins <= 1;
              return (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {m.email}
                      {isSelf ? (
                        <span className="text-score-dim"> {t("access.you")}</span>
                      ) : null}
                    </div>
                    {m.name ? (
                      <div className="truncate text-xs text-score-dim">{m.name}</div>
                    ) : null}
                  </div>

                  {isLastAdmin ? (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-score-dim">
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
                        className="rounded-lg border border-border-strong bg-surface px-2 py-1 text-sm"
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
                      confirm={t("access.removeConfirm", {
                        email: m.email,
                        tenant: ctx.tenant.name,
                      })}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <button
                        type="submit"
                        className="text-xs text-score-dim hover:text-danger"
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

        <Panel title={t("access.roles")}>
          <ul className="space-y-1.5 text-xs text-score-dim">
            {ASSIGNABLE_ROLES.map((r) => (
              <li key={r}>
                <span className="font-medium text-foreground">{ROLE_LABEL[r]}</span>{" "}
                — {ROLE_HINT[r]}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-score-dim">{t("access.pinNote")}</p>
        </Panel>
      </div>
    </Page>
  );
}
