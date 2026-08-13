import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/messages";
import { BrandingForm } from "@/components/admin/BrandingForm";
import {
  DisciplinesForm,
  ReportTypesForm,
} from "@/components/admin/TenantCapabilityForm";
import { LanguageSwitcher } from "@/components/admin/LanguageSwitcher";
import { Page, PageHeader, Panel } from "@/components/ui/Page";
import { SettingsNav, type SettingsSection } from "@/components/ui/SettingsNav";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

const SECTIONS = ["general", "branding", "disciplines", "reports"] as const;
type SectionKey = (typeof SECTIONS)[number];

/**
 * Settings, one section at a time.
 *
 * It used to be five sections stacked in a 768px column, so changing a report
 * type meant scrolling past the whole branding editor. The section is a URL
 * parameter rather than client tab state, which makes "Settings → Branding"
 * something you can link someone to.
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { tenantSlug } = await params;
  const { section: sectionParam } = await searchParams;
  const ctx = await requireRole(
    tenantSlug,
    ["TENANT_ADMIN"],
    `/t/${tenantSlug}/settings`,
  );
  const locale = await getLocale();
  const t = (key: string) => translate(locale, key);

  const active: SectionKey = SECTIONS.includes(sectionParam as SectionKey)
    ? (sectionParam as SectionKey)
    : "general";

  const base = `/t/${tenantSlug}/settings`;
  const sections: SettingsSection[] = [
    {
      key: "general",
      href: `${base}?section=general`,
      label: "General",
      hint: "Interface language",
    },
    {
      key: "branding",
      href: `${base}?section=branding`,
      label: t("settings.branding"),
      hint: "Colours, logo, court",
    },
    {
      key: "disciplines",
      href: `${base}?section=disciplines`,
      label: "Disciplines",
      hint: "What this organisation runs",
    },
    {
      key: "reports",
      href: `${base}?section=reports`,
      label: "Reports",
      hint: "Which documents are offered",
    },
    // Access and Audit are first-class sidebar destinations now; they stay
    // listed here because this is still where people look for them.
    { key: "access", href: `/t/${tenantSlug}/access`, label: "Access" },
    { key: "audit", href: `/t/${tenantSlug}/audit`, label: "Audit log" },
  ];

  return (
    <Page>
      <PageHeader title={t("settings.title")} meta={ctx.tenant.name} />

      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsNav sections={sections} active={active} />

        <div className="min-w-0 flex-1">
          {active === "general" && (
            <Panel title={t("settings.language")} className="max-w-2xl">
              <LanguageSwitcher current={locale} />
              <p className="mt-2 text-xs text-score-dim">
                Your language for the admin interface in this browser — it
                doesn&apos;t change what other members or the public see.
              </p>
            </Panel>
          )}

          {active === "branding" && (
            <div className="max-w-3xl">
              <BrandingForm
                tenantSlug={tenantSlug}
                branding={ctx.tenant.branding}
                enabledDisciplines={ctx.tenant.config.enabledDisciplines}
              />
            </div>
          )}

          {active === "disciplines" && (
            <div className="max-w-2xl">
              <DisciplinesForm
                tenantSlug={tenantSlug}
                enabled={ctx.tenant.config.enabledDisciplines}
              />
            </div>
          )}

          {active === "reports" && (
            <div className="max-w-2xl">
              <ReportTypesForm
                tenantSlug={tenantSlug}
                enabled={ctx.tenant.config.enabledReportTypes}
              />
            </div>
          )}

          {active === "general" && (
            <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
              <Link
                href={`/t/${tenantSlug}/access`}
                className={`${ui.card} transition-colors hover:border-primary`}
              >
                <span className="font-medium">Access</span>
                <span className="mt-1 block text-sm text-score-dim">
                  Grant people Manage, Score, or View access.
                </span>
              </Link>
              <Link
                href={`/t/${tenantSlug}/audit`}
                className={`${ui.card} transition-colors hover:border-primary`}
              >
                <span className="font-medium">Audit log</span>
                <span className="mt-1 block text-sm text-score-dim">
                  Recent administrative changes.
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
