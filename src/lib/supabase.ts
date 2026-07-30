// Server-side Supabase client factory for the App Router.
//
// `createSupabaseServerClient` → Server Components, Route Handlers, and Server
// Actions. It reads/writes the session cookie via `next/headers`, so it must
// NOT be imported from the Proxy (edge) — see src/proxy.ts — nor from any
// Client Component (use `@/lib/supabase-browser` there instead).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions } from "@/lib/subdomain";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    // 8-day rolling persistence + apex-wide domain when subdomains are on.
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` was called from a Server Component, which cannot write
          // cookies. Safe to ignore — the Proxy refreshes the session cookie
          // on the next request.
        }
      },
    },
  });
}
