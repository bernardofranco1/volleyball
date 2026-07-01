"use client";

import { useActionState, useState } from "react";
import { addMember } from "@/lib/access-actions";
import { ADD_MEMBER_INIT, ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/roles";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function AddMemberForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, action] = useActionState(addMember, ADD_MEMBER_INIT);
  const [copied, setCopied] = useState(false);

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-1 font-medium">Add a person</h2>
      <p className="mb-3 text-xs text-score-dim">
        Grants access by email. If they have no account yet, one is created and a
        temporary password is shown once.
      </p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <div className="space-y-3">
        <div>
          <label className={ui.label} htmlFor="member-email">
            Email
          </label>
          <input
            id="member-email"
            name="email"
            type="email"
            required
            placeholder="person@club.org"
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="member-role">
            Role
          </label>
          <select id="member-role" name="role" defaultValue="VIEWER" className={ui.input}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} — {ROLE_HINT[r]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Granting…">Grant access</SubmitButton>
      </div>

      {state.error ? (
        <p className="mt-3 text-sm text-red-400">{state.error}</p>
      ) : null}

      {state.created ? (
        <div className="mt-3 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">
          <p className="font-medium">{state.created.email}</p>
          <p className="mt-1 text-score-dim">{state.created.note}</p>
          {state.created.tempPassword ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded bg-surface px-2 py-1 font-mono text-sm">
                {state.created.tempPassword}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(state.created!.tempPassword!)
                    .then(() => setCopied(true));
                }}
                className="rounded border border-border px-2 py-1 text-xs text-score-dim hover:text-foreground"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
