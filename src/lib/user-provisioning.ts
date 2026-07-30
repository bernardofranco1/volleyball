// Shared account-provisioning helpers (spec/23 addendum): used by the tenant
// Access page (tenant admins) and the platform People console (global admins).
// Server-only — talks to Supabase Auth with the service-role key.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import type { Role } from "@/lib/authz";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { newId } from "@/lib/id";

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
 * Ensure an account + app user row exist for an email. Three outcomes:
 * already-linked user, freshly created account (temp password returned once),
 * or an existing auth account that only needed linking.
 */
export async function provisionUserByEmail(
  email: string,
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
    tempPassword = password;
    note =
      "Account created. Share the temporary password below — they should change it after signing in.";
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
