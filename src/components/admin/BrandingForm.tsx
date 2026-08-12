"use client";

import { useActionState, useState } from "react";
import { updateBranding } from "@/lib/branding-actions";
import { courtVarsFor } from "@/lib/branding";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { BrandPreview, contrastWarnings } from "@/components/admin/BrandPreview";
import { ui } from "@/components/admin/styles";

export function BrandingForm({
  tenantSlug,
  branding,
  enabledDisciplines,
}: {
  tenantSlug: string;
  /** Only these disciplines' court colours are offered (spec/24 §2.1). */
  enabledDisciplines?: readonly ("BEACH" | "INDOOR" | "GRASS" | "LIGHT")[];
  branding: {
    title: string | null;
    primaryColor: string;
    secondaryColor: string;
    logoUrl: string | null;
    scoresheetLogoUrl: string | null;
    fontFamily: string | null;
    courtColorOverrides: Record<string, string> | null;
  };
}) {
  const [state, action] = useActionState(updateBranding, OK);
  const t = useT();
  const overrides = branding.courtColorOverrides ?? {};
  const [title, setTitle] = useState(branding.title ?? "");
  const [primary, setPrimary] = useState(branding.primaryColor);
  const [secondary, setSecondary] = useState(branding.secondaryColor);
  const warnings = contrastWarnings(primary, secondary);

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("settings.branding")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ui.label}>{t("settings.brandTitle")}</label>
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder={t("settings.brandTitleHint")}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label}>{t("settings.primaryColor")}</label>
          <input
            name="primaryColor"
            type="color"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface"
          />
        </div>
        <div>
          <label className={ui.label}>{t("settings.secondaryColor")}</label>
          <input
            name="secondaryColor"
            type="color"
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label}>{t("settings.logoUpload")}</label>
          <input
            name="logoFile"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className={`${ui.input} file:mr-3 file:rounded-md file:border-0 file:bg-surface-raised file:px-3 file:py-1 file:text-sm file:text-foreground`}
          />
          <p className="mt-1 text-xs text-score-dim">
            {t("settings.logoUploadHint")}
          </p>
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
          <label className={ui.label}>{t("settings.scoresheetLogoUrl")}</label>
          <input
            name="scoresheetLogoUrl"
            defaultValue={branding.scoresheetLogoUrl ?? ""}
            placeholder="https://…/federation-logo.png"
            className={ui.input}
          />
          <p className="mt-1 text-xs text-neutral-500">
            {t("settings.scoresheetLogoUrlHint")}
          </p>
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

      {/* Both themes at once (spec/23 §5.3) — tenants run scoreboards in dark
          and back-office in light, so a colour must hold up in each. */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BrandPreview
          mode="dark"
          label={title}
          logoUrl={branding.logoUrl}
          primary={primary}
          secondary={secondary}
        />
        <BrandPreview
          mode="light"
          label={title}
          logoUrl={branding.logoUrl}
          primary={primary}
          secondary={secondary}
        />
      </div>
      {warnings.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          ⚠ {t("settings.contrastWarning")} ({warnings.join(", ")})
        </p>
      )}

      <h3 className="mb-2 mt-5 text-sm font-medium">{t("settings.courtColors")}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {courtVarsFor(enabledDisciplines).map((c) => (
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
