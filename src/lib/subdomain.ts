// Subdomain routing helpers (spec/23 §6). Pure and dependency-free so both the
// edge Proxy and Client Components can import them (src/lib/tenant.ts is
// Node-only — it pulls in the DB client).

/**
 * Cookie remembering the last tenant a user worked in (spec/23 §4): written by
 * the Proxy on authenticated tenant-page requests, read at login to route
 * multi-tenant users straight back to where they were.
 */
export const LAST_TENANT_COOKIE = "lastTenant";

/**
 * Name of the "sign in as…" overlay cookie (spec/26). The NAME lives here, in
 * the dependency-free module, so the edge Proxy can check its presence; the
 * value is signed and verified only in Node (src/lib/impersonation.ts).
 */
export const IMPERSONATION_COOKIE = "vbimp";

/**
 * How long a signed-in session persists in the browser without re-entering a
 * password: 8 days (product decision, 2026-07-30). Auth cookies are rewritten
 * on every token refresh, so this is a ROLLING window — active users are never
 * logged out; only 8 full days of inactivity requires a fresh sign-in.
 */
export const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 8;

/**
 * Shared cookie options for every Supabase client (server, browser, proxy):
 * the 8-day rolling persistence plus, when subdomain routing is configured,
 * the apex-wide domain so one session spans /admin and every tenant subdomain
 * (spec/23 §6.3).
 */
export function authCookieOptions(): { maxAge: number; domain?: string } {
  const root = rootDomain();
  return {
    maxAge: SESSION_COOKIE_MAX_AGE_S,
    ...(root ? { domain: `.${root}` } : {}),
  };
}

/**
 * Labels that can never be tenant subdomains: they collide with (current or
 * plausible) platform infrastructure on the root domain.
 */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "admin",
  "api",
  "app",
  "mail",
  "cdn",
  "assets",
  "staging",
  "dev",
  "status",
  "backup",
  "docs",
]);

/**
 * A valid tenant subdomain is a lowercase DNS label: 1-63 chars of [a-z0-9-],
 * no leading/trailing hyphen, and not reserved.
 */
export function isValidSubdomain(label: string): boolean {
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
  return !RESERVED_SUBDOMAINS.has(label);
}

/** The configured apex domain for subdomain routing, or null (path-only mode). */
export function rootDomain(): string | null {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN || null;
}

/**
 * Extract the tenant subdomain label from a request host, or null when the
 * host isn't a first-level subdomain of the configured root domain (apex,
 * www, vercel.app previews, localhost, reserved labels…).
 */
export function subdomainFromHost(host: string | null): string | null {
  const root = rootDomain();
  if (!root || !host) return null;
  const h = host.toLowerCase().split(":")[0];
  if (h === root || !h.endsWith(`.${root}`)) return null;
  const label = h.slice(0, -(root.length + 1));
  if (label.includes(".")) return null; // deeper levels are not tenants
  return isValidSubdomain(label) ? label : null;
}

// ── Proxy routing decisions (pure — extracted from src/proxy.ts for tests) ──

/**
 * True when a /t/… path requires a session. The three public tenant surfaces
 * (TV scoreboard, token-gated team tablet, public results) skip the auth
 * round-trip entirely (spec/17 perf).
 */
export function isProtectedTenantPath(pathname: string): boolean {
  if (!pathname.startsWith("/t/")) return false;
  return !(
    /^\/t\/[^/]+\/scoreboard\//.test(pathname) ||
    /^\/t\/[^/]+\/matches\/[^/]+\/team\//.test(pathname) ||
    /^\/t\/[^/]+\/results\//.test(pathname)
  );
}

/**
 * The demo tenant was re-slugged fivb-demo → volleyball-scoring (2026-07-28).
 * Returns the replacement path for legacy URLs (printed QR codes, bookmarks),
 * or null when the path isn't affected. Query strings are the caller's — they
 * carry tablet tokens/PIN keys and must be preserved untouched.
 */
export function legacyDemoPath(pathname: string): string | null {
  return pathname === "/t/fivb-demo" || pathname.startsWith("/t/fivb-demo/")
    ? pathname.replace("/t/fivb-demo", "/t/volleyball-scoring")
    : null;
}

export type SubdomainRouting =
  | { kind: "strip"; path: string } // own /t/{slug} path on the subdomain → canonical bare form (308)
  | { kind: "apex" } // another tenant's path or /admin on a subdomain → apex (308)
  | { kind: "rewrite"; path: string } // bare path → internal /t/{slug} rewrite
  | { kind: "passthrough" }; // a tenant-less route that exists at the top level

/**
 * Top-level routes that are NOT tenant pages and must survive on a tenant
 * subdomain host untouched. Everything else bare gets rewritten into
 * `/t/{slug}/…`, which for these would 404: there is no `/t/{slug}/tv`.
 *
 * `/tv` is the TV broadcast overlay (spec/47). It is addressed by VIS match
 * number, like `/m/…`, and belongs to no tenant.
 */
function isTenantLessPath(pathname: string): boolean {
  return pathname === "/tv" || pathname.startsWith("/tv/");
}

/** Where a request on a tenant subdomain host should go (spec/23 §6.2). */
export function routeSubdomainPath(
  pathname: string,
  slug: string,
): SubdomainRouting {
  if (isTenantLessPath(pathname)) {
    return { kind: "passthrough" };
  }
  if (pathname === `/t/${slug}` || pathname.startsWith(`/t/${slug}/`)) {
    return {
      kind: "strip",
      path: pathname.slice(`/t/${slug}`.length) || "/dashboard",
    };
  }
  if (pathname.startsWith("/t/") || pathname.startsWith("/admin")) {
    return { kind: "apex" };
  }
  return {
    kind: "rewrite",
    path: `/t/${slug}${pathname === "/" ? "/dashboard" : pathname}`,
  };
}

/**
 * Canonical URL (or path) for a tenant page. With a root domain configured and
 * a subdomain chosen, links go to `https://{subdomain}.{root}{path}` — the
 * "ends in .com" form; otherwise the `/t/{slug}` path form, valid everywhere.
 * `path` must start with "/".
 */
export function tenantUrl(
  tenant: { slug: string; subdomain: string | null },
  path: string,
): string {
  const root = rootDomain();
  if (root && tenant.subdomain) {
    return `https://${tenant.subdomain}.${root}${path === "/" ? "" : path}`;
  }
  return `/t/${tenant.slug}${path === "/" ? "" : path}`;
}
