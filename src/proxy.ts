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

  const { pathname } = request.nextUrl;
  // Two tenant surfaces aren't user-gated and must skip the auth redirect:
  //   - the scoreboard display (`/t/{slug}/scoreboard/{matchId}`) — public TV view
  //   - the team tablet (`/t/{slug}/matches/{id}/team/{A|B}`) — session-token gated
  const isPublicScoreboard = /^\/t\/[^/]+\/scoreboard\//.test(pathname);
  const isTeamTablet = /^\/t\/[^/]+\/matches\/[^/]+\/team\//.test(pathname);
  const isPublicResults = /^\/t\/[^/]+\/results\//.test(pathname);
  const isProtected =
    pathname.startsWith("/t/") &&
    !isPublicScoreboard &&
    !isTeamTablet &&
    !isPublicResults;

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
