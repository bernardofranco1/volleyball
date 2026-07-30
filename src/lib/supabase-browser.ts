// Browser-only Supabase client. Kept separate from `supabase.ts` (which imports
// `next/headers` for the server client) so importing it from a Client Component
// never pulls a server-only API into the browser bundle.
import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/subdomain";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // 8-day rolling persistence + apex-wide domain when subdomains are on.
    { cookieOptions: authCookieOptions() },
  );
}
