"use client";

import { useActionState, useEffect, useState } from "react";
import { addMember } from "@/lib/access-actions";
import { ADD_MEMBER_INIT, ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL } from "@/lib/roles";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

// The one-time temp password disappears after this long (shoulder-surfing at a
// venue desk); the admin should copy it right away.
const PASSWORD_VISIBLE_MS = 60_000;

export function AddMemberForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, action] = useActionState(addMember, ADD_MEMBER_INIT);
  // Both flags are derived per-result (keyed by the password value) so a new
  // submission naturally resets "Copied" and restarts the dismiss timer.
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
            passwordVisible ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded bg-surface px-2 py-1 font-mono text-sm">
                  {state.created.tempPassword}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    const pw = state.created!.tempPassword!;
                    void navigator.clipboard
                      ?.writeText(pw)
                      .then(() => setCopiedFor(pw));
                  }}
                  className="rounded border border-border px-2 py-1 text-xs text-score-dim hover:text-foreground"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-score-dim">
                The temporary password was hidden after a minute. If it wasn&apos;t
                saved, ask them to use “reset password” on the login page.
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
