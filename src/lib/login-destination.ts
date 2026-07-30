// Where a signed-in user belongs (spec/23 §4). Shared by the login action and
// the session-aware public pages (/ and /login), so "already signed in" and
// "just signed in" land in exactly the same place.
import { cookies } from "next/headers";
import { isGlobalAdmin } from "@/lib/authz";
import { getUserTenants } from "@/lib/tenant";
import { LAST_TENANT_COOKIE, tenantUrl } from "@/lib/subdomain";

/**
 * Global admins → the platform console; single-tenant members → their
 * dashboard; multi-tenant members → their last tenant (proxy-written cookie)
 * or the picker. Null when the account has no access yet — the caller decides
 * what a signed-in-but-tenantless visitor should see.
 */
export async function postLoginDestination(
  userId: string,
): Promise<string | null> {
  if (await isGlobalAdmin(userId)) return "/admin";
  const memberships = await getUserTenants(userId);
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return tenantUrl(memberships[0], "/dashboard");
  const last = (await cookies()).get(LAST_TENANT_COOKIE)?.value;
  const match = memberships.find((m) => m.slug === last);
  return match ? tenantUrl(match, "/dashboard") : "/select-tenant";
}

/**
 * Cheap session probe for public pages: only when a Supabase auth cookie is
 * present is the real (network) user check worth paying — anonymous visitors
 * stay off the auth path entirely (spec/17 perf discipline).
 */
export async function maybeSessionDestination(): Promise<string | null> {
  const cookieStore = await cookies();
  if (!cookieStore.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  // Deferred import keeps the supabase server client out of pages that never
  // see a session cookie.
  const { getCurrentUser } = await import("@/lib/authz");
  const user = await getCurrentUser();
  if (!user) return null;
  return postLoginDestination(user.id);
}
