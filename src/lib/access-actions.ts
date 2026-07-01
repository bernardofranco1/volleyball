"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import { requireRole, type Role } from "@/lib/authz";
import { adminCount } from "@/lib/access";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { newId } from "@/lib/id";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import type { AddMemberState } from "@/lib/roles";

// Access management is TENANT_ADMIN only.
const MANAGE_ACCESS: Role[] = ["TENANT_ADMIN"];
const ASSIGNABLE: Role[] = ["TENANT_ADMIN", "COMPETITION_ADMIN", "SCORER", "VIEWER"];

// Readable temporary password (no ambiguous characters), e.g. "kM7Qp-r9Fa2".
function genPassword(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += A[b % A.length];
  return `${s.slice(0, 5)}-${s.slice(5, 12)}`;
}

/**
 * Grant exactly one role to a user in a tenant (replaces any existing rows).
 * Transactional — a failure between the two statements must not strip the
 * member of all roles.
 */
async function setSingleRole(tenantId: string, userId: string, role: Role) {
  await db.transaction(async (tx) => {
    await tx
      .delete(userTenantRoles)
      .where(
        and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, tenantId)),
      );
    await tx
      .insert(userTenantRoles)
      .values({ id: newId("utr"), userId, tenantId, role });
  });
}

async function isTenantAdmin(tenantId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userTenantRoles.id })
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.tenantId, tenantId),
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.role, "TENANT_ADMIN"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Add a person by email + role, provisioning an account if they lack one. */
export async function addMember(
  _prev: AddMemberState,
  fd: FormData,
): Promise<AddMemberState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, MANAGE_ACCESS);
  const email = str(fd, "email").toLowerCase();
  const role = str(fd, "role") as Role;

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (!ASSIGNABLE.includes(role)) return { error: "Choose a role." };

  // Already linked in this app?
  const existing = (
    await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  )[0];

  let userId = existing?.id ?? null;
  let tempPassword: string | null = null;
  let note: string;

  if (userId) {
    note = "Existing user — role updated.";
  } else {
    const admin = createSupabaseAdminClient();
    const password = genPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!error && data?.user) {
      userId = data.user.id;
      tempPassword = password;
      note =
        "Account created. Share the temporary password below — they should change it after signing in.";
    } else {
      // The auth account may exist without an app link — find and reuse it.
      // listUsers is paginated (50/page): scan pages rather than only the first,
      // otherwise members beyond page one look like "couldn't create".
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
      note = "Existing account linked. Ask them to reset their password if they can't sign in.";
    }
    await db
      .insert(users)
      .values({ id: userId, email })
      .onConflictDoUpdate({ target: users.id, set: { email } });
  }

  await setSingleRole(ctx.tenant.id, userId, role);
  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "access.grant",
    entityType: "user",
    entityId: userId,
    summary: `Granted ${role} to ${email}`,
  });
  revalidatePath(`/t/${tenantSlug}/access`);
  return { error: null, created: { email, tempPassword, note } };
}

/**
 * Change a member's role. Guards (last-admin) are also enforced in the UI by
 * hiding the control; this server check is defence-in-depth, and reports why
 * nothing changed instead of silently no-opping.
 */
export async function setMemberRole(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, MANAGE_ACCESS);
  const userId = str(fd, "userId");
  const role = str(fd, "role") as Role;
  if (!userId || !ASSIGNABLE.includes(role)) return fail("Choose a role.");

  if (
    role !== "TENANT_ADMIN" &&
    (await isTenantAdmin(ctx.tenant.id, userId)) &&
    (await adminCount(ctx.tenant.id)) <= 1
  ) {
    return fail("This is the tenant's last admin — promote someone else first.");
  }

  await setSingleRole(ctx.tenant.id, userId, role);
  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "access.role",
    entityType: "user",
    entityId: userId,
    summary: `Set role ${role}`,
  });
  revalidatePath(`/t/${tenantSlug}/access`);
  return ok("Role updated.");
}

/** Revoke a member's access (never removes yourself or the last admin). */
export async function removeMember(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const tenantSlug = str(fd, "tenantSlug");
  const ctx = await requireRole(tenantSlug, MANAGE_ACCESS);
  const userId = str(fd, "userId");
  if (!userId) return fail("Missing user.");
  if (userId === ctx.user.id)
    return fail("You can't remove your own access.");
  if (
    (await isTenantAdmin(ctx.tenant.id, userId)) &&
    (await adminCount(ctx.tenant.id)) <= 1
  ) {
    return fail("This is the tenant's last admin — promote someone else first.");
  }

  await db
    .delete(userTenantRoles)
    .where(
      and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, ctx.tenant.id)),
    );
  await recordAudit({
    tenantId: ctx.tenant.id,
    actor: { userId: ctx.user.id, email: ctx.user.email },
    action: "access.revoke",
    entityType: "user",
    entityId: userId,
    summary: "Revoked tenant access",
  });
  revalidatePath(`/t/${tenantSlug}/access`);
  return ok("Access revoked.");
}
