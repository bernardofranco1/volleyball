"use client";

import { useActionState } from "react";
import { updateBranding } from "@/lib/branding-actions";
import { COURT_VARS } from "@/lib/branding";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function BrandingForm({
  tenantSlug,
  branding,
}: {
  tenantSlug: string;
  branding: {
    primaryColor: string;
    secondaryColor: string;
    logoUrl: string | null;
    fontFamily: string | null;
    courtColorOverrides: Record<string, string> | null;
  };
}) {
  const [state, action] = useActionState(updateBranding, OK);
  const t = useT();
  const overrides = branding.courtColorOverrides ?? {};

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("settings.branding")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={ui.label}>{t("settings.primaryColor")}</label>
          <input
            name="primaryColor"
            type="color"
            defaultValue={branding.primaryColor}
            className="h-10 w-full rounded-lg border border-border bg-surface"
          />
        </div>
        <div>
          <label className={ui.label}>{t("settings.secondaryColor")}</label>
          <input
            name="secondaryColor"
            type="color"
            defaultValue={branding.secondaryColor}
            className="h-10 w-full rounded-lg border border-border bg-surface"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label}>{t("settings.logoUrl")}</label>
          <input
            name="logoUrl"
            defaultValue={branding.logoUrl ?? ""}
            placeholder="https://…/logo.svg"
            className={ui.input}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label}>{t("settings.fontFamily")}</label>
          <input
            name="fontFamily"
            defaultValue={branding.fontFamily ?? ""}
            placeholder="e.g. Inter, system-ui"
            className={ui.input}
          />
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-medium">{t("settings.courtColors")}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {COURT_VARS.map((c) => (
          <div key={c.key}>
            <label className="mb-1 block text-[11px] text-score-dim">{c.label}</label>
            <input
              name={c.key}
              type="color"
              defaultValue={overrides[c.key] ?? c.fallback}
              className="h-9 w-full rounded-lg border border-border bg-surface"
            />
          </div>
        ))}
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}

      <div className="mt-4">
        <SubmitButton pendingLabel="…">{t("settings.save")}</SubmitButton>
      </div>
    </form>
  );
}
