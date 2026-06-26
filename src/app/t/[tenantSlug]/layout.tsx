import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { logout } from "@/lib/auth-actions";
import { getTenantBySlug } from "@/lib/tenant";
import { getT } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";

// Tenant pages are user- and DB-specific, so never prerender at build time.
export const dynamic = "force-dynamic";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    notFound();
  }
  const { locale, t, messages } = await getT();

  // Inject brand tokens: colours, optional font, and any court-colour overrides.
  // These cascade over the base tokens in globals.css, so `*-primary` and
  // `*-court-*` utilities below the wrapper re-brand.
  const brandingVars: Record<string, string> = {
    "--primary": tenant.branding.primaryColor,
    "--primary-fg": tenant.branding.secondaryColor,
    ...(tenant.branding.courtColorOverrides ?? {}),
  };
  const style: CSSProperties = {
    ...(brandingVars as CSSProperties),
    ...(tenant.branding.fontFamily
      ? { fontFamily: tenant.branding.fontFamily }
      : {}),
  };

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <div
        style={style}
        data-tenant={tenant.slug}
        className="flex min-h-screen flex-col"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            {tenant.branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.branding.logoUrl}
                alt={`${tenant.name} logo`}
                className="h-7 w-auto"
              />
            ) : (
              <span
                className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-fg"
                aria-hidden
              >
                {tenant.name.charAt(0)}
              </span>
            )}
            <span className="font-semibold">{tenant.name}</span>
          </div>

          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground"
            >
              {t("nav.signOut")}
            </button>
          </form>
        </header>

        <div className="flex-1">{children}</div>
      </div>
    </LocaleProvider>
  );
}
