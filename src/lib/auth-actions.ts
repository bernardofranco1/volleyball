"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { clearImpersonationCookie } from "@/lib/impersonation";
import { postLoginDestination } from "@/lib/login-destination";
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

  // Destination (spec/23 §4): explicit redirectTo wins, then the shared
  // signed-in routing (console / dashboard / last-tenant / picker).
  const destination =
    safeRedirect(redirectTo) ||
    (await postLoginDestination(data.user.id)) ||
    "/";

  // redirect() throws NEXT_REDIRECT — must be outside any try/catch.
  redirect(destination);
}

/** Server Action: sign out and return to the login page. */
export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // signOut() clears only the Supabase cookies. An impersonation overlay
  // (spec/26) must not survive the session it hangs off — clear it too, or the
  // next sign-in on this browser would resume "as" the old target.
  await clearImpersonationCookie();
  redirect("/login");
}
