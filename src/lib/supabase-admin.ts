// Service-role Supabase client for privileged auth-admin operations (creating
// accounts for people a tenant admin grants access to). Uses the secret service
// role key — MUST only ever be imported from server code (Server Actions /
// Route Handlers), never a Client Component.
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin client not configured (URL / service key).");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
