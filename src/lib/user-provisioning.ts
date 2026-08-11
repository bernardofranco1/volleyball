// Shared account-provisioning helpers (spec/23 addendum): used by the tenant
// Access page (tenant admins) and the platform People console (global admins).
// Server-only — talks to Supabase Auth with the service-role key.
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { db, dbTx } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import type { Role } from "@/lib/authz";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { emailConfigured, sendTemplatedEmail } from "@/lib/email";
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
 * Email-safe set-password URL: our own page carrying the token_hash. The
 * token is only consumed when the person presses the page's submit button —
 * mail scanners that pre-fetch (or even render) the link can't burn it.
 */
function scannerSafeLink(
  origin: string,
  tokenHash: string,
  type: "recovery" | "invite",
): string {
  return `${origin}/auth/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

/** "bernardo.franco@x" → "Bernardo" — the welcome email's fallback greeting. */
export function firstNameFrom(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0].split(/[._-]/)[0];
  const word = source.split(/\s+/)[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Send a set-your-password email to an EXISTING account (resends, lost
 * invites). With SMTP configured, the app renders the configurable recovery
 * template (config/emails/) around a link minted via generateLink. Without
 * SMTP it falls back to Supabase's default mailer, first probing that our
 * redirect survives the project's allowlist (GoTrue silently rewrites
 * disallowed redirects to the Site URL, which may be a dead end). Either way
 * the caller shows a temp password instead when nothing could be sent.
 */
export async function sendPasswordSetupEmail(
  email: string,
  origin: string,
  values?: { name?: string | null; accessSummary?: string | null },
): Promise<{ sent: true } | { sent: false; reason: string }> {
  const target = `${origin}/auth/set-password`;
  const admin = createSupabaseAdminClient();

  const probe = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: target },
  });
  if (probe.error) return { sent: false, reason: probe.error.message };
  const actionLink = probe.data.properties.action_link;
  const kept = new URL(actionLink).searchParams.get("redirect_to");
  if (!kept || !kept.startsWith(origin)) {
    return {
      sent: false,
      reason:
        "the app URL is not in the Supabase Auth redirect allowlist (Dashboard → Auth → URL Configuration)",
    };
  }

  // App-side send (configurable template) when SMTP is available. The email
  // links to OUR set-password page with the token_hash — NOT the one-time
  // GoTrue /verify URL: corporate mail scanners (Microsoft Safe Links etc.)
  // pre-fetch links and would consume the token before the human clicks
  // (2026-07-30 incident). Verification happens only on the page's submit.
  if (emailConfigured()) {
    return sendTemplatedEmail("recovery", email, {
      firstName: firstNameFrom(values?.name ?? null, email),
      accessDetails: values?.accessSummary ?? null,
      setPasswordLink: scannerSafeLink(
        origin,
        probe.data.properties.hashed_token,
        "recovery",
      ),
      email,
    });
  }

  // Fallback: Supabase's own mailer (fixed template, tight rate limits).
  // resetPasswordForEmail is the one service that emails EXISTING users a
  // set-password link. It mints a NEW token; the probe link above is simply
  // superseded.
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
 * invitation flow when possible: a WELCOME email (the configurable invite
 * template — see config/emails/) with the person's name and what they were
 * granted, falling back to a one-time temporary password when the email
 * can't be sent. Existing accounts are returned untouched.
 */
export async function provisionUserByEmail(
  email: string,
  opts?: {
    passwordEmail?: boolean;
    origin?: string;
    /** Person's name — stored on the account and greeting the welcome email. */
    name?: string | null;
    /** What they're being granted — rendered as [ACCESS_DETAILS] in the email. */
    accessSummary?: string | null;
  },
): Promise<ProvisionResult> {
  const existing = (
    await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  )[0];
  if (existing) {
    return { userId: existing.id, tempPassword: null, note: "Existing user." };
  }

  const admin = createSupabaseAdminClient();

  // Invitation flow first (spec/23 addendum), best transport available:
  //  a. SMTP configured → create the account, mint a one-time link, and send
  //     the configurable WELCOME template (config/emails/invite.html) with
  //     the person's name and what they were granted.
  //  b. No SMTP → Supabase's default mailer via inviteUserByEmail (fixed
  //     wording, tight rate limits) — still a working link.
  // Any failure falls through to the one-time temp password: never leave the
  // person credential-less.
  if (opts?.passwordEmail && opts.origin) {
    const meta = {
      first_name: firstNameFrom(opts.name ?? null, email),
      access_details: opts.accessSummary ?? null,
      full_name: opts.name || null,
    };
    if (emailConfigured()) {
      const password = genPassword(); // random, never shown — the link replaces it
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: meta,
      });
      if (!created.error && created.data?.user) {
        await db
          .insert(users)
          .values({ id: created.data.user.id, email, name: opts.name || null })
          .onConflictDoUpdate({ target: users.id, set: { email } });
        const link = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${opts.origin}/auth/set-password` },
        });
        const sent = link.error
          ? { sent: false as const, reason: link.error.message }
          : await sendTemplatedEmail("invite", email, {
              firstName: meta.first_name,
              accessDetails: meta.access_details,
              // Scanner-safe: our page + token_hash, verified on submit only
              // (see sendPasswordSetupEmail for the incident note).
              setPasswordLink: scannerSafeLink(
                opts.origin,
                link.data.properties.hashed_token,
                "recovery",
              ),
              email,
            });
        if (sent.sent) {
          return {
            userId: created.data.user.id,
            tempPassword: null,
            note:
              "Account created and a welcome email sent — they'll choose their own password via the link (worth checking spam the first time).",
          };
        }
        console.warn(`welcome email to ${email} not sent: ${sent.reason}`);
        return {
          userId: created.data.user.id,
          tempPassword: password,
          note:
            "Account created. The welcome email could not be sent, so share the temporary password below instead — they should change it after signing in.",
        };
      }
      // Creation failed (account may already exist in auth) → shared fallback.
    } else {
      const invited = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${opts.origin}/auth/set-password`,
        data: meta,
      });
      if (!invited.error && invited.data?.user) {
        await db
          .insert(users)
          .values({ id: invited.data.user.id, email, name: opts.name || null })
          .onConflictDoUpdate({ target: users.id, set: { email } });
        return {
          userId: invited.data.user.id,
          tempPassword: null,
          note:
            "Account created and a welcome email sent — they'll choose their own password via the link (worth checking spam the first time).",
        };
      }
      console.warn(`invite email to ${email} not sent: ${invited.error?.message}`);
    }
  }

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
    tempPassword = password;
    note = opts?.passwordEmail
      ? "Account created. The welcome email could not be sent, so share the temporary password below instead — they should change it after signing in."
      : "Account created. Share the temporary password below — they should change it after signing in.";
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
    .values({ id: userId, email, name: opts?.name || null })
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
  await dbTx.transaction(async (tx) => {
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
