"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getUserPrimaryTenantSlug } from "@/lib/tenant";
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

  // Send the user to their tenant dashboard (or the route they were heading to).
  let destination = safeRedirect(redirectTo);
  if (!destination) {
    const slug = await getUserPrimaryTenantSlug(data.user.id);
    destination = slug ? `/t/${slug}/dashboard` : "/";
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
