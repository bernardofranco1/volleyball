// Browser-only Supabase client. Kept separate from `supabase.ts` (which imports
// `next/headers` for the server client) so importing it from a Client Component
// never pulls a server-only API into the browser bundle.
import { createBrowserClient } from "@supabase/ssr";
import { rootDomain } from "@/lib/subdomain";

export function createSupabaseBrowserClient() {
  const root = rootDomain();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // One session across the apex and every tenant subdomain (spec/23 §6.3).
    root ? { cookieOptions: { domain: `.${root}` } } : undefined,
  );
}
