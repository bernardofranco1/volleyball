"use client";

// Platform People console list (global-admin only, English-only surface):
// quick search + per-person controls (global flag, memberships, password
// email/reset, delete). Server actions are imported directly; the page passes
// serialisable data only.
import { useMemo, useState } from "react";
import {
  deleteUserAccount,
  grantTenantRole,
  revokeTenantRole,
  sendPasswordEmail,
  setGlobalAdminFlag,
} from "@/lib/user-admin-actions";
import { ASSIGNABLE_ROLES, ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/authz";
import { ActionForm } from "@/components/admin/ActionForm";
import { ResetPasswordButton } from "@/components/admin/ResetPasswordButton";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export interface PersonRow {
  id: string;
  email: string;
  name: string | null;
  isGlobalAdmin: boolean;
  memberships: {
    tenantId: string;
    tenantName: string;
    role: Role;
  }[];
}

export function PeopleList({
  people,
  tenants,
  meId,
}: {
  people: PersonRow[];
  tenants: { id: string; name: string }[];
  meId: string;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) ||
        (u.name ?? "").toLowerCase().includes(needle) ||
        (u.isGlobalAdmin && "global admin".includes(needle)) ||
        u.memberships.some(
          (m) =>
            m.tenantName.toLowerCase().includes(needle) ||
            ROLE_LABEL[m.role].toLowerCase().includes(needle),
        ),
    );
  }, [people, q]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by email, name, tenant or role…"
        aria-label="Search people"
        className={ui.input}
      />
      {filtered.length === 0 && (
        <p className="text-sm text-score-dim">No one matches “{q}”.</p>
      )}

      {filtered.map((u) => (
        <div key={u.id} className={ui.card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{u.email}</span>
                {u.id === meId && (
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
            <div className="flex flex-wrap items-center gap-2">
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
              <ActionForm action={sendPasswordEmail}>
                <input type="hidden" name="userId" value={u.id} />
                <SubmitButton variant="secondary" pendingLabel="Sending…">
                  Email password link
                </SubmitButton>
              </ActionForm>
              <ResetPasswordButton userId={u.id} email={u.email} />
              {u.id !== meId && (
                <ActionForm
                  action={deleteUserAccount}
                  confirm={`Delete ${u.email} from the platform? Their sign-in account and all tenant access are removed. This cannot be undone.`}
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <SubmitButton variant="danger" pendingLabel="Deleting…">
                    Delete
                  </SubmitButton>
                </ActionForm>
              )}
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
                {tenants.map((t) => (
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
  );
}
