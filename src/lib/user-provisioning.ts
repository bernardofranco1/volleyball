// Shared account-provisioning helpers (spec/23 addendum): used by the tenant
// Access page (tenant admins) and the platform People console (global admins).
// Server-only — talks to Supabase Auth with the service-role key.
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import type { Role } from "@/lib/authz";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { newId } from "@/lib/id";

/** The public origin for links in outgoing emails (env first, headers fallback). */
export async function appOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Readable temporary password (no ambiguous characters), e.g. "kM7Qp-r9Fa2". */
export function genPassword(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += A[b % A.length];
  return `${s.slice(0, 5)}-${s.slice(5, 12)}`;
}

export type ProvisionResult =
  | { userId: string; tempPassword: string | null; note: string }
  | { error: string };

/**
 * Try to send a set-your-password email (the invitation flow, spec/23
 * addendum) and report honestly whether it will actually reach a usable page.
 *
 * Two failure modes are detected up front:
 *  1. The Supabase project's redirect allowlist doesn't include our origin —
 *     GoTrue then silently rewrites the link to the project's Site URL, which
 *     may be a dead end. Probed via generateLink (creates no email) by
 *     comparing the `redirect_to` GoTrue actually kept against what we asked.
 *  2. The mailer refuses (e.g. the default dev SMTP's hourly rate limit).
 * Either way the caller falls back to a one-time temp password.
 */
export async function sendPasswordSetupEmail(
  email: string,
  origin: string,
): Promise<{ sent: true } | { sent: false; reason: string }> {
  const target = `${origin}/auth/set-password`;
  const admin = createSupabaseAdminClient();

  const probe = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: target },
  });
  if (probe.error) return { sent: false, reason: probe.error.message };
  const kept = new URL(probe.data.properties.action_link).searchParams.get(
    "redirect_to",
  );
  if (!kept || !kept.startsWith(origin)) {
    return {
      sent: false,
      reason:
        "the app URL is not in the Supabase Auth redirect allowlist (Dashboard → Auth → URL Configuration)",
    };
  }

  // Send the real email with the anon key — resetPasswordForEmail is the one
  // service that emails EXISTING users a set-password link.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await anon.auth.resetPasswordForEmail(email, {
    redirectTo: target,
  });
  if (error) return { sent: false, reason: error.message };
  return { sent: true };
}

/**
 * Ensure an account + app user row exist for an email. New accounts get the
 * invitation flow when possible: a set-your-password email (opts.origin set
 * and the project allows the redirect), falling back to a one-time temporary
 * password otherwise. Existing accounts are returned untouched.
 */
export async function provisionUserByEmail(
  email: string,
  opts?: { passwordEmail?: boolean; origin?: string },
): Promise<ProvisionResult> {
  const existing = (
    await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  )[0];
  if (existing) {
    return { userId: existing.id, tempPassword: null, note: "Existing user." };
  }

  const admin = createSupabaseAdminClient();
  const password = genPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId: string;
  let tempPassword: string | null;
  let note: string;
  if (!error && data?.user) {
    userId = data.user.id;
    // Invitation flow first (spec/23 addendum): email a set-your-password
    // link; the account keeps its random unseen password until the person
    // chooses their own. Falls back to showing the temp password once.
    let emailed = false;
    if (opts?.passwordEmail && opts.origin) {
      const sent = await sendPasswordSetupEmail(email, opts.origin);
      if (sent.sent) {
        emailed = true;
      } else {
        console.warn(`password email to ${email} not sent: ${sent.reason}`);
      }
    }
    if (emailed) {
      tempPassword = null;
      note =
        "Account created and an invitation email sent — they'll choose their own password via the link (worth checking spam the first time).";
    } else {
      tempPassword = password;
      note = opts?.passwordEmail
        ? "Account created. The invitation email could not be sent, so share the temporary password below instead — they should change it after signing in."
        : "Account created. Share the temporary password below — they should change it after signing in.";
    }
  } else {
    // The auth account may exist without an app link — find and reuse it.
    // listUsers is paginated: scan pages rather than only the first, otherwise
    // members beyond page one look like "couldn't create".
    let found: { id: string } | undefined;
    for (let page = 1; page <= 20 && !found; page++) {
      const { data: list, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError || !list || list.users.length === 0) break;
      found = list.users.find((u) => u.email?.toLowerCase() === email);
      if (list.users.length < 200) break; // last page
    }
    if (!found) return { error: error?.message ?? "Couldn't create the account." };
    userId = found.id;
    tempPassword = null;
    note =
      "Existing account linked. Ask them to reset their password if they can't sign in.";
  }

  await db
    .insert(users)
    .values({ id: userId, email })
    .onConflictDoUpdate({ target: users.id, set: { email } });

  return { userId, tempPassword, note };
}

/**
 * Set a new temporary password on an existing account (e.g. the invite
 * response was lost, or the person never received their credentials).
 */
export async function resetUserPassword(
  userId: string,
): Promise<{ tempPassword: string } | { error: string }> {
  const admin = createSupabaseAdminClient();
  const tempPassword = genPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (error) return { error: error.message };
  return { tempPassword };
}

/**
 * Grant exactly one role to a user in a tenant (replaces any existing rows).
 * Transactional — a failure between the two statements must not strip the
 * member of all roles.
 */
export async function setSingleRole(
  tenantId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.userId, userId),
          eq(userTenantRoles.tenantId, tenantId),
        ),
      );
    await tx
      .insert(userTenantRoles)
      .values({ id: newId("utr"), userId, tenantId, role });
  });
}
