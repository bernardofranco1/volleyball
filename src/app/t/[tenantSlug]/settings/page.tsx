import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/messages";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { LanguageSwitcher } from "@/components/admin/LanguageSwitcher";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await requireRole(
    tenantSlug,
    ["TENANT_ADMIN"],
    `/t/${tenantSlug}/settings`,
  );
  const locale = await getLocale();
  const t = (key: string) => translate(locale, key);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <Link href={`/t/${tenantSlug}/dashboard`} className={ui.btnSecondary}>
          ← {t("nav.dashboard")}
        </Link>
      </div>

      <div className="space-y-6">
        <div className={ui.card}>
          <h2 className="mb-3 font-medium">{t("settings.language")}</h2>
          <LanguageSwitcher current={locale} />
          <p className="mt-2 text-xs text-score-dim">
            Applies to the shell, dashboard, and settings. A full string sweep
            across every screen is incremental.
          </p>
        </div>

        <BrandingForm
          tenantSlug={tenantSlug}
          branding={ctx.tenant.branding}
        />

        <Link
          href={`/t/${tenantSlug}/audit`}
          className={`${ui.card} flex items-center justify-between transition-colors hover:border-primary`}
        >
          <span>
            <span className="font-medium">Audit log</span>
            <span className="mt-1 block text-sm text-score-dim">
              Recent administrative changes (lifecycle, deletes, bracket, tokens).
            </span>
          </span>
          <span className="text-score-dim">→</span>
        </Link>

        <div className={`${ui.card} text-xs text-score-dim`}>
          <p className="mb-1 font-medium text-foreground">Custom domain</p>
          Mapping a tenant to a custom domain (Vercel Domains API) is configured at
          deployment — see Phase 10/11.
        </div>
      </div>
    </main>
  );
}
