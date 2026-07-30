import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { logout } from "@/lib/auth-actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentUser, isGlobalAdmin, type Role } from "@/lib/authz";
import { getTenantBySlug, getUserTenants, tenantTitle } from "@/lib/tenant";
import { listTenantsForSwitcher } from "@/lib/tenant-admin";
import { tenantUrl } from "@/lib/subdomain";
import { ROLE_LABEL } from "@/lib/roles";
import { getT } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { MobileNav } from "@/components/MobileNav";
import { TenantSwitcher, type SwitcherTenant } from "@/components/TenantSwitcher";

// Tenant pages are user- and DB-specific, so never prerender at build time.
export const dynamic = "force-dynamic";

// Top-nav destinations (brief §1.2). Shared by the desktop bar and the mobile
// nav row so phones aren't stranded on the dashboard.
const NAV_LINKS = [
  ["nav.dashboard", "dashboard"],
  ["nav.competitions", "competitions"],
  ["nav.matches", "matches"],
  ["nav.settings", "settings"],
] as const;

/** Browser-tab title = the tenant's product name (spec/23 §5.1). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return {};
  const title = tenantTitle(tenant);
  return { title: { default: title, template: `%s | ${title}` } };
}

const ROLE_RANK: Record<Role, number> = {
  TENANT_ADMIN: 4,
  COMPETITION_ADMIN: 3,
  SCORER: 2,
  VIEWER: 1,
};

/**
 * Switcher data for the signed-in user, or null when the plain wordmark link
 * should render (no session, or a single-tenant member). Public surfaces
 * (scoreboard, tablets, results) carry no Supabase cookie, so the cheap
 * cookie-presence test keeps them off the auth path entirely (spec/17 perf).
 */
async function getSwitcher(currentSlug: string): Promise<{
  tenants: SwitcherTenant[];
  showManage: boolean;
} | null> {
  const cookieStore = await cookies();
  if (!cookieStore.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const globalAdmin = await isGlobalAdmin(user.id);
  if (globalAdmin) {
    const all = await listTenantsForSwitcher();
    return {
      showManage: true,
      tenants: all.map((t) => ({
        slug: t.slug,
        label: t.title ?? t.name,
        logoUrl: t.logoUrl,
        roleLabel: null,
        url: tenantUrl(t, "/dashboard"),
        current: t.slug === currentSlug,
      })),
    };
  }

  const mine = await getUserTenants(user.id);
  if (mine.length <= 1) return null;
  return {
    showManage: false,
    tenants: mine.map((t) => {
      const top = (t.roles as Role[]).reduce(
        (a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a),
        "VIEWER" as Role,
      );
      return {
        slug: t.slug,
        label: t.title ?? t.name,
        logoUrl: t.logoUrl,
        roleLabel: ROLE_LABEL[top],
        url: tenantUrl(t, "/dashboard"),
        current: t.slug === currentSlug,
      };
    }),
  };
}

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
  const [{ locale, t, messages }, switcher] = await Promise.all([
    getT(),
    getSwitcher(tenantSlug),
  ]);
  const title = tenantTitle(tenant);

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
        className="flex min-h-dvh flex-col"
      >
        <header className="relative flex items-center justify-between border-b border-border px-4 py-2 md:px-6 md:py-4">
          <div className="flex items-center gap-3 md:gap-6">
            {/* Mobile: ☰ collapses the nav (saves a UI row). Desktop: hidden. */}
            <MobileNav
              menuLabel={t("nav.menu")}
              links={NAV_LINKS.map(([key, path]) => ({
                href: `/t/${tenantSlug}/${path}`,
                label: t(key),
              }))}
            />
            {switcher ? (
              <TenantSwitcher
                current={{
                  label: title,
                  logoUrl: tenant.branding.logoUrl,
                  dashboardHref: `/t/${tenantSlug}/dashboard`,
                }}
                tenants={switcher.tenants}
                showManage={switcher.showManage}
              />
            ) : (
              <Link
                href={`/t/${tenantSlug}/dashboard`}
                className="flex items-center gap-3"
              >
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
                    {title.charAt(0)}
                  </span>
                )}
                <span className="font-semibold">{title}</span>
              </Link>
            )}
            {/* Top navigation menu (brief §1.2). */}
            <nav className="hidden items-center gap-1 md:flex">
              {NAV_LINKS.map(([key, path]) => (
                <Link
                  key={path}
                  href={`/t/${tenantSlug}/${path}`}
                  className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  {t(key)}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground"
              >
                {t("nav.signOut")}
              </button>
            </form>
          </div>
        </header>

        {/* Flex column + min-h-0 so a full-height child (the scoring shell) can
            fill the viewport below the header; normal pages just flow/scroll. */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </LocaleProvider>
  );
}
