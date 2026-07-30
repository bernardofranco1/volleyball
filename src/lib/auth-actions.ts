"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getUserTenants } from "@/lib/tenant";
import { isGlobalAdmin } from "@/lib/authz";
import { LAST_TENANT_COOKIE, tenantUrl } from "@/lib/subdomain";
import { rateLimitAuth } from "@/lib/ratelimit";

import { safeRedirect } from "@/lib/http";

export interface LoginState {
  error: string | null;
}

/** Server Action: email/password sign-in via Supabase Auth. */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Throttle credential stuffing / password spraying — per account and per IP.
  const ip =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const [byEmail, byIp] = await Promise.all([
    rateLimitAuth(`login:email:${email.toLowerCase()}`),
    rateLimitAuth(`login:ip:${ip}`),
  ]);
  if (!byEmail || !byIp) {
    return { error: "Too many attempts. Please wait a minute and try again." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Destination (spec/23 §4): explicit redirectTo wins; global admins land on
  // the platform console; single-tenant members go straight in; multi-tenant
  // members return to their last tenant (cookie, written by the Proxy) or the
  // picker when there is no valid last one.
  let destination = safeRedirect(redirectTo);
  if (!destination) {
    if (await isGlobalAdmin(data.user.id)) {
      destination = "/admin";
    } else {
      const memberships = await getUserTenants(data.user.id);
      if (memberships.length === 0) {
        destination = "/";
      } else if (memberships.length === 1) {
        destination = tenantUrl(memberships[0], "/dashboard");
      } else {
        const last = (await cookies()).get(LAST_TENANT_COOKIE)?.value;
        const match = memberships.find((m) => m.slug === last);
        destination = match
          ? tenantUrl(match, "/dashboard")
          : "/select-tenant";
      }
    }
  }

  // redirect() throws NEXT_REDIRECT — must be outside any try/catch.
  redirect(destination);
}

/** Server Action: sign out and return to the login page. */
export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
