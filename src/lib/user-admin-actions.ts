"use server";

// Platform People console actions (global admin only): provision accounts,
// grant/revoke GLOBAL or per-tenant access, reset passwords. Tenant admins
// keep their own tenant-scoped Access page (access-actions.ts) — this console
// is the superset for platform operators.
//
// Platform-level events (global-admin flag, password resets) have no tenant to
// audit into (audit_log.tenant_id is NOT NULL by design); tenant-scoped grants
// are audited into the affected tenant like the tenant Access page does.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import { requireGlobalAdmin, type Role } from "@/lib/authz";
import { adminCount } from "@/lib/access";
import { getTenantById } from "@/lib/tenant-admin";
import {
  provisionUserByEmail,
  resetUserPassword,
  setSingleRole,
} from "@/lib/user-provisioning";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import type { AddMemberState } from "@/lib/roles";

const ASSIGNABLE: Role[] = [
  "TENANT_ADMIN",
  "COMPETITION_ADMIN",
  "SCORER",
  "VIEWER",
];

/**
 * Add a person to the platform: provision the account, then grant either
 * global-admin access or a role in one tenant. Shows the one-time temporary
 * password when an account was created.
 */
export async function addPlatformUser(
  _prev: AddMemberState,
  fd: FormData,
): Promise<AddMemberState> {
  const { user: actor } = await requireGlobalAdmin();
  const email = str(fd, "email").toLowerCase();
  if (!email || !email.includes("@"))
    return { error: "Enter a valid email address." };

  const access = str(fd, "access"); // "global" | "tenant"
  const tenantId = str(fd, "tenantId");
  const role = str(fd, "role") as Role;
  if (access !== "global") {
    if (!tenantId) return { error: "Pick a tenant." };
    if (!ASSIGNABLE.includes(role)) return { error: "Choose a role." };
  }

  const provisioned = await provisionUserByEmail(email);
  if ("error" in provisioned) return { error: provisioned.error };

  if (access === "global") {
    await db
      .update(users)
      .set({ isGlobalAdmin: true })
      .where(eq(users.id, provisioned.userId));
  } else {
    const tenant = await getTenantById(tenantId);
    if (!tenant) return { error: "Unknown tenant." };
    await setSingleRole(tenant.id, provisioned.userId, role);
    await recordAudit({
      tenantId: tenant.id,
      actor: { userId: actor.id, email: actor.email },
      action: "access.grant",
      entityType: "user",
      entityId: provisioned.userId,
      summary: `Granted ${role} to ${email} (platform console)`,
    });
  }

  revalidatePath("/admin/access");
  return {
    error: null,
    created: {
      email,
      tempPassword: provisioned.tempPassword,
      note:
        access === "global"
          ? `${provisioned.note} Global admin access granted.`
          : provisioned.note,
    },
  };
}

/** Grant or revoke the global-admin flag. You cannot revoke your own. */
export async function setGlobalAdminFlag(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  const enable = str(fd, "enable") === "true";
  if (!userId) return fail("Missing user.");
  if (!enable && userId === actor.id)
    return fail(
      "You can't revoke your own global access — ask another global admin.",
    );

  const r = await db
    .update(users)
    .set({ isGlobalAdmin: enable })
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  if (r.length === 0) return fail("Unknown user.");

  revalidatePath("/admin/access");
  return ok(enable ? "Global access granted." : "Global access revoked.");
}

/** Grant / change a user's role in a tenant (platform console). */
export async function grantTenantRole(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  const tenantId = str(fd, "tenantId");
  const role = str(fd, "role") as Role;
  if (!userId || !tenantId) return fail("Missing user or tenant.");
  if (!ASSIGNABLE.includes(role)) return fail("Choose a role.");
  const tenant = await getTenantById(tenantId);
  if (!tenant) return fail("Unknown tenant.");

  await setSingleRole(tenantId, userId, role);
  await recordAudit({
    tenantId,
    actor: { userId: actor.id, email: actor.email },
    action: "access.role",
    entityType: "user",
    entityId: userId,
    summary: `Set role ${role} (platform console)`,
  });
  revalidatePath("/admin/access");
  return ok(`Access to ${tenant.name} saved.`);
}

/** Revoke a user's access to one tenant. Last-admin guard applies. */
export async function revokeTenantRole(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  const tenantId = str(fd, "tenantId");
  if (!userId || !tenantId) return fail("Missing user or tenant.");

  const isAdmin = (
    await db
      .select({ id: userTenantRoles.id })
      .from(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.tenantId, tenantId),
          eq(userTenantRoles.userId, userId),
          eq(userTenantRoles.role, "TENANT_ADMIN"),
        ),
      )
      .limit(1)
  ).length;
  if (isAdmin && (await adminCount(tenantId)) <= 1)
    return fail("This is the tenant's last admin — promote someone else first.");

  await db
    .delete(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.tenantId, tenantId),
      ),
    );
  await recordAudit({
    tenantId,
    actor: { userId: actor.id, email: actor.email },
    action: "access.revoke",
    entityType: "user",
    entityId: userId,
    summary: "Revoked tenant access (platform console)",
  });
  revalidatePath("/admin/access");
  return ok("Access revoked.");
}

/** New one-time temporary password for an account (lost invite, etc.). */
export async function resetPassword(
  _prev: AddMemberState,
  fd: FormData,
): Promise<AddMemberState> {
  await requireGlobalAdmin();
  const userId = str(fd, "userId");
  if (!userId) return { error: "Missing user." };
  const row = (
    await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) return { error: "Unknown user." };

  const r = await resetUserPassword(userId);
  if ("error" in r) return { error: r.error };
  return {
    error: null,
    created: {
      email: row.email,
      tempPassword: r.tempPassword,
      note: "New temporary password set — share it once; they should change it after signing in.",
    },
  };
}
