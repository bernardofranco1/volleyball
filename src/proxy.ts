// Next.js 16 Proxy (formerly Middleware). Runs before every matched request.
//
// Responsibilities (kept deliberately lightweight, per the Next.js guidance
// that the Proxy should do optimistic checks only — not data fetching):
//   1. Refresh the Supabase auth session cookie on every request.
//   2. Optimistically redirect unauthenticated users away from tenant routes.
//
// Authorization (which tenant / which role) is verified in Server Components
// against the database — see src/lib/tenant.ts and the tenant layout.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  if (!isProtected) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  let user = null;
  try {
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    user = u;
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
