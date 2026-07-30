"use client";

// Global-admin tenant config (spec/23 §3.2): name + subdomain. The slug is
// shown read-only (immutable — it's in printed QR codes); branding lives in
// the shared BrandingForm below this one on the page.
import { useActionState } from "react";
import { updateTenantConfig } from "@/lib/tenant-admin-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function TenantConfigForm({
  tenant,
}: {
  tenant: { id: string; slug: string; name: string; subdomain: string | null };
}) {
  const [state, action] = useActionState(updateTenantConfig, OK);

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">General</h2>
      <input type="hidden" name="tenantId" value={tenant.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={ui.label}>Name</label>
          <input name="name" defaultValue={tenant.name} required className={ui.input} />
        </div>
        <div>
          <label className={ui.label}>Slug (immutable)</label>
          <input
            value={tenant.slug}
            readOnly
            disabled
            className={`${ui.input} font-mono opacity-60`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label}>Subdomain</label>
          <input
            name="subdomain"
            defaultValue={tenant.subdomain ?? ""}
            placeholder="lisbon"
            className={`${ui.input} font-mono`}
          />
          <p className="mt-1 text-xs text-score-dim">
            Changing it takes effect immediately once a custom root domain is
            configured — the old subdomain stops resolving (no redirect).
          </p>
        </div>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}

      <div className="mt-4">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}
