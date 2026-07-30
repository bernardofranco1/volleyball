// Next.js 16 Proxy (formerly Middleware). Runs before every matched request.
//
// Responsibilities (kept deliberately lightweight, per the Next.js guidance
// that the Proxy should do optimistic checks only — not data fetching):
//   1. Resolve tenant subdomains → internal /t/{slug} rewrite (spec/23 §6).
//   2. Refresh the Supabase auth session cookie on every request.
//   3. Optimistically redirect unauthenticated users away from tenant routes.
//   4. Remember the last tenant an authenticated user visited (login routing).
//
// Authorization (which tenant / which role) is verified in Server Components
// against the database — see src/lib/tenant.ts and the tenant layout.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  LAST_TENANT_COOKIE,
  rootDomain,
  subdomainFromHost,
} from "@/lib/subdomain";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// With a root domain configured, auth cookies span the apex (/admin) and every
// tenant subdomain — one session everywhere (spec/23 §6.3).
function cookieDomain(): { domain: string } | undefined {
  const root = rootDomain();
  return root ? { domain: `.${root}` } : undefined;
}

// Per-instance memo for subdomain → slug (the resolve route is CDN-cached too;
// this removes even the fetch on steady state). null = known-unknown.
const subdomainCache = new Map<string, { slug: string | null; exp: number }>();
const SUBDOMAIN_MEMO_MS = 60_000;

async function resolveSubdomain(
  req: NextRequest,
  label: string,
): Promise<string | null> {
  const hit = subdomainCache.get(label);
  if (hit && hit.exp > Date.now()) return hit.slug;
  let slug: string | null = null;
  try {
    // /api/* is excluded from the proxy matcher, so this cannot recurse.
    const res = await fetch(
      `${req.nextUrl.origin}/api/tenants/resolve?subdomain=${encodeURIComponent(label)}`,
      { headers: { accept: "application/json" } },
    );
    if (res.ok) slug = ((await res.json()) as { slug: string | null }).slug;
  } catch {
    // Resolution outage → treat as unknown; the tenant stays reachable via
    // its /t/{slug} path form.
  }
  subdomainCache.set(label, { slug, exp: Date.now() + SUBDOMAIN_MEMO_MS });
  return slug;
}

export async function proxy(request: NextRequest) {
  let { pathname } = request.nextUrl;
  // Set when a subdomain host maps this request into /t/{slug}/… — every exit
  // path below must then send a rewrite response instead of a plain next().
  let rewriteUrl: URL | null = null;
  const pass = () =>
    rewriteUrl
      ? NextResponse.rewrite(rewriteUrl, { request })
      : NextResponse.next({ request });

  // ── Tenant subdomains (spec/23 §6.2) — inert until ROOT_DOMAIN is set ─────
  const label = subdomainFromHost(request.headers.get("host"));
  if (label) {
    const slug = await resolveSubdomain(request, label);
    if (!slug) {
      // Unknown/deleted subdomain → 404 (rewrite to a path no route serves).
      const url = request.nextUrl.clone();
      url.pathname = "/tenant-not-found";
      return NextResponse.rewrite(url, { status: 404 });
    }
    if (pathname === `/t/${slug}` || pathname.startsWith(`/t/${slug}/`)) {
      // Path-form URL opened on the subdomain host → canonical bare form.
      const url = request.nextUrl.clone();
      url.pathname = pathname.slice(`/t/${slug}`.length) || "/dashboard";
      return NextResponse.redirect(url, 308);
    }
    if (pathname.startsWith("/t/") || pathname.startsWith("/admin")) {
      // Another tenant's path (or the console) on a subdomain host → apex.
      const url = request.nextUrl.clone();
      url.hostname = rootDomain()!;
      return NextResponse.redirect(url, 308);
    }
    // Internal rewrite: the browser URL stays https://{label}.{root}/…
    rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/t/${slug}${pathname === "/" ? "/dashboard" : pathname}`;
    pathname = rewriteUrl.pathname;
  }

  // The demo tenant was re-slugged fivb-demo → volleyball-scoring (branding,
  // 2026-07-28). Permanent redirect keeps every printed QR code, scorer
  // deep-link and bookmark alive — query strings (tablet tokens, PIN keys)
  // are carried over untouched.
  if (pathname === "/t/fivb-demo" || pathname.startsWith("/t/fivb-demo/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace("/t/fivb-demo", "/t/volleyball-scoring");
    return NextResponse.redirect(url, 308);
  }

  // Decide whether the path is user-gated BEFORE paying the Supabase Auth
  // round trip — public scoreboards/tablets/results were previously spending
  // 30-80ms on an auth check whose result was discarded.
  //   - the scoreboard display (`/t/{slug}/scoreboard/{matchId}`) — public TV view
  //   - the team tablet (`/t/{slug}/matches/{id}/team/{A|B}`) — session-token gated
  //   - public results (`/t/{slug}/results/…`)
  const isPublicScoreboard = /^\/t\/[^/]+\/scoreboard\//.test(pathname);
  const isTeamTablet = /^\/t\/[^/]+\/matches\/[^/]+\/team\//.test(pathname);
  const isPublicResults = /^\/t\/[^/]+\/results\//.test(pathname);
  const isProtected =
    pathname.startsWith("/t/") &&
    !isPublicScoreboard &&
    !isTeamTablet &&
    !isPublicResults;

  if (!isProtected) return pass();

  let response = pass();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: cookieDomain(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = pass();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Optimistic check: getClaims() verifies the JWT locally against the
  // project's published ES256 JWKS (no Auth-server round trip on the hot
  // path), refreshing the session first when it has expired. Real
  // authorization still happens in authz.ts against the database.
  let user = null;
  try {
    const { data } = await supabase.auth.getClaims();
    user = data?.claims ?? null;
  } catch {
    // Supabase unreachable (e.g. local dev without credentials). Treat as
    // unauthenticated so protected routes still redirect to login.
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Remember the tenant for the next login (spec/23 §4). Written only on
  // authenticated tenant pages, only when it changed.
  const slugMatch = /^\/t\/([^/]+)/.exec(pathname);
  if (slugMatch && request.cookies.get(LAST_TENANT_COOKIE)?.value !== slugMatch[1]) {
    response.cookies.set(LAST_TENANT_COOKIE, slugMatch[1], {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      ...cookieDomain(),
    });
  }

  return response;
}

export const config = {
  // Run on everything except static assets, image files, and /api/* — every
  // API route does its own authorization (authorizeMatch / tablet tokens), and
  // Route Handlers can refresh + persist the session cookie themselves, so the
  // proxy's getUser() there was a pure extra auth round trip on the hottest
  // paths (scoring POSTs, state/interrupt polling).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
