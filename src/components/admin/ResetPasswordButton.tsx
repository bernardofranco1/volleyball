"use client";

// One-click temporary-password reset (platform console). The new password is
// shown once, with copy — for invites whose credentials never reached the
// person (e.g. a lost response).
import { useActionState, useState } from "react";
import { resetPassword } from "@/lib/user-admin-actions";
import { ADD_MEMBER_INIT } from "@/lib/roles";
import { SubmitButton } from "@/components/admin/SubmitButton";

export function ResetPasswordButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const [state, action] = useActionState(resetPassword, ADD_MEMBER_INIT);
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form
        action={action}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Set a NEW temporary password for ${email}? Their current password stops working.`,
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <SubmitButton variant="secondary" pendingLabel="Resetting…">
          Reset password
        </SubmitButton>
      </form>
      {state.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
      {state.created?.tempPassword && (
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded bg-surface px-2 py-1 font-mono text-xs">
            {state.created.tempPassword}
          </code>
          <button
            type="button"
            className="text-xs text-score-dim hover:text-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(state.created!.tempPassword!);
              setCopied(true);
            }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
