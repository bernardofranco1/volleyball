"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getUserPrimaryTenantSlug } from "@/lib/tenant";

export interface LoginState {
  error: string | null;
}

/**
 * Only honor same-origin relative destinations (spec/14 §A3). Blocks open
 * redirects via `?redirectTo=https://evil.com` and protocol-relative `//evil`.
 */
function safeRedirect(dest: string): string {
  return /^\/(?![/\\])/.test(dest) ? dest : "";
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
