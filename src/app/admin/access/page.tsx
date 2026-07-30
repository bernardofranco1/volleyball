import { requireGlobalAdmin } from "@/lib/authz";
import { listAllUsers } from "@/lib/user-admin";
import { listAllTenants } from "@/lib/tenant-admin";
import {
  grantTenantRole,
  revokeTenantRole,
  setGlobalAdminFlag,
} from "@/lib/user-admin-actions";
import { ASSIGNABLE_ROLES, ROLE_LABEL } from "@/lib/roles";
import { ActionForm } from "@/components/admin/ActionForm";
import { AddPlatformUserForm } from "@/components/admin/AddPlatformUserForm";
import { ResetPasswordButton } from "@/components/admin/ResetPasswordButton";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// Platform People console (spec/23 addendum): who can reach the platform at
// all — global admins and every tenant membership — managed in one place.
// Tenant admins keep managing their own members on /t/{slug}/access.
export default async function AdminAccessPage() {
  const { user: me } = await requireGlobalAdmin("/admin/access");
  const [usersList, tenants] = await Promise.all([listAllUsers(), listAllTenants()]);
  const liveTenants = tenants
    .filter((t) => !t.deletedAt)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-score-dim">
          Everyone with platform access. Global admins control every tenant and
          this console; everyone else holds per-tenant roles, which tenant
          admins can also manage on their own Access page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          {usersList.map((u) => (
            <div key={u.id} className={ui.card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{u.email}</span>
                    {u.id === me.id && (
                      <span className="text-xs text-score-dim">(you)</span>
                    )}
                    {u.isGlobalAdmin && (
                      <span className="rounded-full border border-primary/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                        global admin
                      </span>
                    )}
                  </div>
                  {u.name && (
                    <div className="truncate text-xs text-score-dim">{u.name}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <ActionForm
                    action={setGlobalAdminFlag}
                    confirm={
                      u.isGlobalAdmin
                        ? `Revoke GLOBAL access for ${u.email}? They keep any per-tenant roles.`
                        : `Grant ${u.email} GLOBAL admin access to every tenant and this console?`
                    }
                  >
                    <input type="hidden" name="userId" value={u.id} />
                    <input
                      type="hidden"
                      name="enable"
                      value={u.isGlobalAdmin ? "false" : "true"}
                    />
                    <SubmitButton
                      variant={u.isGlobalAdmin ? "danger" : "secondary"}
                      pendingLabel="…"
                    >
                      {u.isGlobalAdmin ? "Revoke global" : "Make global admin"}
                    </SubmitButton>
                  </ActionForm>
                  <ResetPasswordButton userId={u.id} email={u.email} />
                </div>
              </div>

              {/* Tenant memberships */}
              <div className="mt-3 space-y-2">
                {u.memberships.map((m) => (
                  <div
                    key={m.tenantId}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {m.tenantName}
                      <span className="text-score-dim"> · {ROLE_LABEL[m.role]}</span>
                    </span>
                    <ActionForm
                      action={revokeTenantRole}
                      confirm={`Remove ${u.email} from ${m.tenantName}?`}
                    >
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="tenantId" value={m.tenantId} />
                      <button
                        type="submit"
                        className="text-xs text-score-dim hover:text-red-400"
                      >
                        Remove
                      </button>
                    </ActionForm>
                  </div>
                ))}
                {u.memberships.length === 0 && !u.isGlobalAdmin && (
                  <p className="text-xs text-score-dim">No tenant access.</p>
                )}

                {/* Grant access to (another) tenant */}
                <ActionForm
                  action={grantTenantRole}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <select
                    name="tenantId"
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                    aria-label={`Tenant to grant ${u.email} access to`}
                  >
                    {liveTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    name="role"
                    defaultValue="VIEWER"
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                    aria-label="Role"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <SubmitButton variant="secondary" pendingLabel="…">
                    Grant
                  </SubmitButton>
                </ActionForm>
              </div>
            </div>
          ))}
        </div>

        <AddPlatformUserForm tenants={liveTenants} />
      </div>
    </main>
  );
}
