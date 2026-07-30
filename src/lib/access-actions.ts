"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userTenantRoles } from "@/db/schema";
import { requireRole, type Role } from "@/lib/authz";
import { adminCount } from "@/lib/access";
import {
  appOrigin,
  provisionUserByEmail,
  setSingleRole,
} from "@/lib/user-provisioning";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import { ROLE_LABEL, type AddMemberState } from "@/lib/roles";

// Access management is TENANT_ADMIN only.
const MANAGE_ACCESS: Role[] = ["TENANT_ADMIN"];
const ASSIGNABLE: Role[] = ["TENANT_ADMIN", "COMPETITION_ADMIN", "SCORER", "VIEWER"];

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

  const provisioned = await provisionUserByEmail(email, {
    passwordEmail: true,
    origin: await appOrigin(),
    name: str(fd, "name") || null,
    accessSummary: `${ctx.tenant.name} — ${ROLE_LABEL[role]}`,
  });
  if ("error" in provisioned) return { error: provisioned.error };
  const { userId, tempPassword } = provisioned;
  const note =
    provisioned.tempPassword === null && provisioned.note === "Existing user."
      ? "Existing user — role updated."
      : provisioned.note;

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
