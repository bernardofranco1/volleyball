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

      <div className="space-y-10">
        {/* ── General ── */}
        <section aria-labelledby="settings-general">
          <h2
            id="settings-general"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            General
          </h2>
          <div className={ui.card}>
            <h3 className="mb-3 font-medium">{t("settings.language")}</h3>
            <LanguageSwitcher current={locale} />
            <p className="mt-2 text-xs text-score-dim">
              Your language for the admin interface in this browser — it doesn&apos;t
              change what other members or the public see.
            </p>
          </div>
        </section>

        {/* ── Branding ── */}
        <section aria-labelledby="settings-branding">
          <h2
            id="settings-branding"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            Branding
          </h2>
          <BrandingForm tenantSlug={tenantSlug} branding={ctx.tenant.branding} />
        </section>

        {/* ── People & security ── */}
        <section aria-labelledby="settings-people">
          <h2
            id="settings-people"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
          >
            People &amp; security
          </h2>
          <div className="space-y-4">
            <Link
              href={`/t/${tenantSlug}/access`}
              className={`${ui.card} flex items-center justify-between transition-colors hover:border-primary`}
            >
              <span>
                <span className="font-medium">Access</span>
                <span className="mt-1 block text-sm text-score-dim">
                  Grant people Manage, Score, or View access. Scoring also asks
                  for a match&apos;s PIN when one is set.
                </span>
              </span>
              <span className="text-score-dim">→</span>
            </Link>

            <Link
              href={`/t/${tenantSlug}/audit`}
              className={`${ui.card} flex items-center justify-between transition-colors hover:border-primary`}
            >
              <span>
                <span className="font-medium">Audit log</span>
                <span className="mt-1 block text-sm text-score-dim">
                  Recent administrative changes (lifecycle, deletes, bracket,
                  tokens).
                </span>
              </span>
              <span className="text-score-dim">→</span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
