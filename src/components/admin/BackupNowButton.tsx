"use client";

import { useActionState } from "react";
import { runTenantBackup } from "@/lib/tenant-admin-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";

export function BackupNowButton({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState(runTenantBackup, OK);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <SubmitButton variant="secondary" pendingLabel="Backing up…">
        Back up now
      </SubmitButton>
      {state.error && <span className="text-sm text-red-400">{state.error}</span>}
      {state.ok && state.message && (
        <span role="status" className="text-sm text-emerald-400">
          {state.message}
        </span>
      )}
    </form>
  );
}
