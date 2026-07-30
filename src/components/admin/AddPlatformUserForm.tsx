"use client";

// Platform console "add person" (global-admin only, English-only surface):
// provision an account and grant GLOBAL access or a role in one tenant.
// One-time temp password display mirrors the tenant AddMemberForm.
import { useActionState, useEffect, useState } from "react";
import { addPlatformUser } from "@/lib/user-admin-actions";
import { ADD_MEMBER_INIT, ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/roles";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

const PASSWORD_VISIBLE_MS = 60_000;

export function AddPlatformUserForm({
  tenants,
}: {
  tenants: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(addPlatformUser, ADD_MEMBER_INIT);
  const [access, setAccess] = useState<"tenant" | "global">("tenant");
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    const pw = state.created?.tempPassword;
    if (!pw) return;
    const t = setTimeout(() => setDismissedFor(pw), PASSWORD_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [state]);

  const tempPassword = state.created?.tempPassword ?? null;
  const passwordVisible = tempPassword != null && dismissedFor !== tempPassword;
  const copied = tempPassword != null && copiedFor === tempPassword;

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-1 font-medium">Add a person</h2>
      <p className="mb-3 text-xs text-score-dim">
        Creates the account if needed (temporary password shown once), then
        grants platform-wide or tenant access.
      </p>

      <div className="space-y-3">
        <div>
          <label className={ui.label} htmlFor="pu-email">
            Email
          </label>
          <input
            id="pu-email"
            name="email"
            type="email"
            required
            placeholder="person@federation.org"
            className={ui.input}
          />
        </div>

        <div>
          <span className={ui.label}>Access</span>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="access"
                value="tenant"
                checked={access === "tenant"}
                onChange={() => setAccess("tenant")}
              />
              Access to one tenant
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="access"
                value="global"
                checked={access === "global"}
                onChange={() => setAccess("global")}
              />
              Global admin — full control of every tenant and this console
            </label>
          </div>
        </div>

        {access === "tenant" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={ui.label} htmlFor="pu-tenant">
                Tenant
              </label>
              <select id="pu-tenant" name="tenantId" className={ui.select} required>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={ui.label} htmlFor="pu-role">
                Role
              </label>
              <select id="pu-role" name="role" defaultValue="TENANT_ADMIN" className={ui.select}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]} — {ROLE_HINT[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <SubmitButton pendingLabel="Granting…">Grant access</SubmitButton>
      </div>

      {state.error ? <p className="mt-3 text-sm text-red-400">{state.error}</p> : null}

      {state.created ? (
        <div className="mt-3 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">
          <p className="font-medium">{state.created.email}</p>
          <p className="mt-1 text-score-dim">{state.created.note}</p>
          {state.created.tempPassword && passwordVisible ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded bg-surface px-2 py-1 font-mono text-sm">
                {state.created.tempPassword}
              </code>
              <button
                type="button"
                className={ui.btnSecondary}
                onClick={() => {
                  void navigator.clipboard.writeText(state.created!.tempPassword!);
                  setCopiedFor(state.created!.tempPassword!);
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
