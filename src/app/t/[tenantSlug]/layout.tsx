import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { logout } from "@/lib/auth-actions";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  ADMIN_ROLES,
  getAuthContext,
  getCurrentUser,
  hasRole,
  isGlobalAdmin,
  VIEW_ROLES,
  type Role,
} from "@/lib/authz";
import { getTenantBySlug, getUserTenants, tenantTitle } from "@/lib/tenant";
import { listTenantsForSwitcher } from "@/lib/tenant-admin";
import { tenantUrl } from "@/lib/subdomain";
import { ROLE_LABEL } from "@/lib/roles";
import { getT } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { MobileNav } from "@/components/MobileNav";
import { TenantNav } from "@/components/TenantNav";
import { TenantSwitcher, type SwitcherTenant } from "@/components/TenantSwitcher";
import { AppShell } from "@/components/ui/AppShell";
import { AppSidebar, type IconKey, type SidebarGroup } from "@/components/ui/AppSidebar";

// Tenant pages are user- and DB-specific, so never prerender at build time.
export const dynamic = "force-dynamic";

// Console destinations, in two sidebar groups: the day-to-day surfaces, then
// the organisation ones. Access and Audit are here rather than buried behind
// Settings, which is where they lived and where nobody found them.
//
// `roles` gates each entry (spec/24 §8). Previously every entry rendered for
// everyone, so a VIEWER was shown Competitions and Settings and got a 404 on
// click — each page gates itself with notFound(), which is correct but made the
// menu a list of dead ends. null = no role requirement.
const NAV_GROUPS: {
  labelKey?: string;
  links: { key: string; path: string; icon: IconKey; roles: Role[] | null }[];
}[] = [
  {
    links: [
      { key: "nav.dashboard", path: "dashboard", icon: "home", roles: null },
      {
        key: "nav.competitions",
        path: "competitions",
        icon: "trophy",
        roles: ADMIN_ROLES,
      },
      { key: "nav.matches", path: "matches", icon: "grid", roles: VIEW_ROLES },
      { key: "nav.people", path: "people", icon: "users", roles: ADMIN_ROLES },
    ],
  },
  {
    labelKey: "nav.organisation",
    links: [
      {
        key: "nav.settings",
        path: "settings",
        icon: "gear",
        roles: ["TENANT_ADMIN"],
      },
      {
        key: "nav.access",
        path: "access",
        icon: "key",
        roles: ["TENANT_ADMIN"],
      },
      { key: "nav.audit", path: "audit", icon: "list", roles: ["TENANT_ADMIN"] },
    ],
  },
];

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

/**
 * The signed-in user's roles in this tenant, or null when there is no session.
 * Same cheap cookie pre-check as getSwitcher: the public surfaces under this
 * layout (scoreboard, results, team tablets) carry no Supabase cookie and must
 * not touch the auth path (spec/17 perf discipline). No session ⇒ no nav entries,
 * which is right for a TV board.
 */
async function getNavRoles(tenantSlug: string): Promise<Role[] | null> {
  const cookieStore = await cookies();
  if (!cookieStore.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  const ctx = await getAuthContext(tenantSlug);
  return ctx?.roles ?? null;
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
  const [{ locale, t, messages }, switcher, navRoles] = await Promise.all([
    getT(),
    getSwitcher(tenantSlug),
    getNavRoles(tenantSlug),
  ]);
  const title = tenantTitle(tenant);

  // Only offer what this user can actually open (spec/24 §8).
  const navGroups: SidebarGroup[] = NAV_GROUPS.map((g) => ({
    label: g.labelKey ? t(g.labelKey) : undefined,
    links: g.links
      .filter(
        (l) =>
          l.roles === null || (navRoles !== null && hasRole(navRoles, l.roles)),
      )
      .map((l) => ({
        href: `/t/${tenantSlug}/${l.path}`,
        label: t(l.key),
        icon: l.icon,
      })),
  })).filter((g) => g.links.length > 0);
  // Flat list for the mobile ☰ panel and the console top bar, which have no
  // room for section captions.
  const navLinks = navGroups.flatMap((g) =>
    g.links.map((l) => ({ href: l.href, label: l.label })),
  );

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

  // The brand block is shared by both chromes; only its density differs.
  const brand = (sidebar: boolean) =>
    switcher ? (
      <TenantSwitcher
        current={{
          label: title,
          logoUrl: tenant.branding.logoUrl,
          dashboardHref: `/t/${tenantSlug}/dashboard`,
        }}
        tenants={switcher.tenants}
        showManage={switcher.showManage}
        sidebar={sidebar}
      />
    ) : (
      <Link
        href={`/t/${tenantSlug}/dashboard`}
        className={`flex items-center gap-3 ${sidebar ? "max-xl:justify-center" : ""}`}
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
            className="grid h-7 w-7 flex-none place-items-center rounded-md bg-primary text-xs font-bold text-primary-fg"
            aria-hidden
          >
            {title.charAt(0)}
          </span>
        )}
        <span
          className={`truncate font-semibold ${sidebar ? "max-xl:sr-only" : ""}`}
        >
          {title}
        </span>
      </Link>
    );

  const signOut = (compact = false) => (
    <form action={logout}>
      <button
        type="submit"
        title={t("nav.signOut")}
        className={`rounded-lg border border-border text-sm text-score-dim transition-colors hover:text-foreground ${
          compact
            ? "px-2 py-1.5 xl:px-3"
            : "px-3 py-1.5"
        }`}
      >
        {/* The icon rail has no room for the word; the full sidebar does. */}
        <span aria-hidden className={compact ? "xl:hidden" : "hidden"}>
          ⏻
        </span>
        <span className={compact ? "max-xl:sr-only" : ""}>
          {t("nav.signOut")}
        </span>
      </button>
    </form>
  );

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <div style={style} data-tenant={tenant.slug} className="min-h-dvh">
        <AppShell
          sidebar={
            <AppSidebar
              brand={brand(true)}
              groups={navGroups}
              footer={
                <div className="flex items-center gap-1.5 max-xl:flex-col">
                  <ThemeToggle />
                  {signOut(true)}
                </div>
              }
            />
          }
          // Below md the sidebar is gone entirely and the ☰ panel carries the
          // same links — management pages stay usable on a phone even though
          // they are not optimised for one.
          mobileBar={
            <header className="relative flex items-center justify-between gap-3 border-b border-border px-4 py-2 md:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <MobileNav menuLabel={t("nav.menu")} links={navLinks} />
                {brand(false)}
              </div>
              <ThemeToggle />
            </header>
          }
          // The scorer console, tablets and public boards keep the original
          // top bar untouched (see AppShell.isConsoleRoute).
          consoleHeader={
            <header className="relative flex items-center justify-between border-b border-border px-4 py-2 md:px-6 md:py-4">
              <div className="flex items-center gap-3 md:gap-6">
                <MobileNav menuLabel={t("nav.menu")} links={navLinks} />
                {brand(false)}
                <TenantNav links={navLinks} />
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                {signOut()}
              </div>
            </header>
          }
        >
          {children}
        </AppShell>
      </div>
    </LocaleProvider>
  );
}
