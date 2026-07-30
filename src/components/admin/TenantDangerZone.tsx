"use client";

// Soft delete / restore (spec/23 §3.4). Deletion demands the exact tenant name
// and always takes a final FULL backup server-side before flipping deleted_at.
import { useActionState, useState } from "react";
import { restoreTenant, softDeleteTenant } from "@/lib/tenant-admin-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function TenantDangerZone({
  tenant,
  graceDays,
}: {
  tenant: {
    id: string;
    name: string;
    deletedAt: string | null; // ISO — serialisable across the RSC boundary
    isTestTenant: boolean;
  };
  graceDays: number;
}) {
  const [deleteState, deleteAction] = useActionState(softDeleteTenant, OK);
  const [restoreState, restoreAction] = useActionState(restoreTenant, OK);
  const [confirm, setConfirm] = useState("");

  if (tenant.deletedAt) {
    const restoreUntil = new Date(
      new Date(tenant.deletedAt).getTime() + graceDays * 86_400_000,
    );
    return (
      <div className={`${ui.card} border-red-500/40`}>
        <h2 className="mb-2 font-medium text-red-400">Deleted</h2>
        <p className="mb-4 text-sm text-score-dim">
          All URLs for this tenant are dark. It will be purged permanently after{" "}
          {restoreUntil.toLocaleDateString()} — restore it before then to undo.
        </p>
        <form action={restoreAction}>
          <input type="hidden" name="tenantId" value={tenant.id} />
          <SubmitButton pendingLabel="Restoring…">Restore tenant</SubmitButton>
        </form>
        {restoreState.error && (
          <p className="mt-3 text-sm text-red-400">{restoreState.error}</p>
        )}
      </div>
    );
  }

  if (tenant.isTestTenant) {
    return (
      <div className={ui.card}>
        <h2 className="mb-2 font-medium">Danger zone</h2>
        <p className="text-sm text-score-dim">
          The Test tenant cannot be deleted — it hosts the demo data and the
          nightly reseed.
        </p>
      </div>
    );
  }

  return (
    <div className={`${ui.card} border-red-500/40`}>
      <h2 className="mb-2 font-medium text-red-400">Danger zone</h2>
      <p className="mb-4 text-sm text-score-dim">
        Deleting takes a final full backup, then hides the tenant everywhere.
        It stays restorable for {graceDays} days, after which all its data is
        purged permanently.
      </p>
      <form action={deleteAction} className="space-y-3">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <div>
          <label className={ui.label}>
            Type “{tenant.name}” to confirm deletion
          </label>
          <input
            name="confirmName"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            className={ui.input}
          />
        </div>
        <SubmitButton
          variant="danger"
          pendingLabel="Backing up & deleting…"
          className={confirm === tenant.name ? "" : "pointer-events-none opacity-40"}
        >
          Delete tenant
        </SubmitButton>
        {deleteState.error && (
          <p className="text-sm text-red-400">{deleteState.error}</p>
        )}
        {deleteState.ok && deleteState.message && (
          <p role="status" className="text-sm text-emerald-400">
            {deleteState.message}
          </p>
        )}
      </form>
    </div>
  );
}
