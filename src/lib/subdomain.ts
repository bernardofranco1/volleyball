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
