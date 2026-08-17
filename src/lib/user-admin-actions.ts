"use server";

// Platform People console actions (global admin only): provision accounts,
// grant/revoke GLOBAL or per-tenant access, reset passwords. Tenant admins
// keep their own tenant-scoped Access page (access-actions.ts) — this console
// is the superset for platform operators.
//
// Platform-level events (global-admin flag, password resets, deletions) have no
// tenant to audit into: since migration 0017 they are recorded with a NULL
// tenant_id and surface on /admin/audit (spec/26 §9). Tenant-scoped grants are
// still audited into the affected tenant, like the tenant Access page does.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import { requireGlobalAdmin, type Role } from "@/lib/authz";
import { adminCount } from "@/lib/access";
import { getTenantById } from "@/lib/tenant-admin";
import {
  appOrigin,
  provisionUserByEmail,
  resetUserPassword,
  sendPasswordSetupEmail,
  setSingleRole,
} from "@/lib/user-provisioning";
import {
  authWriteBlockedReason,
  createSupabaseAdminClient,
} from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import { ROLE_LABEL, type AddMemberState } from "@/lib/roles";

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
  const name = str(fd, "name") || null;

  const access = str(fd, "access"); // "global" | "tenant"
  const tenantId = str(fd, "tenantId");
  const role = str(fd, "role") as Role;
  let accessSummary =
    "Global administrator — full access to every tenant and the platform console";
  let grantTenant: Awaited<ReturnType<typeof getTenantById>> = null;
  if (access !== "global") {
    if (!tenantId) return { error: "Pick a tenant." };
    if (!ASSIGNABLE.includes(role)) return { error: "Choose a role." };
    grantTenant = await getTenantById(tenantId);
    if (!grantTenant) return { error: "Unknown tenant." };
    accessSummary = `${grantTenant.name} — ${ROLE_LABEL[role]}`;
  }

  const provisioned = await provisionUserByEmail(email, {
    passwordEmail: true,
    origin: await appOrigin(),
    name,
    accessSummary,
  });
  if ("error" in provisioned) return { error: provisioned.error };

  if (access === "global") {
    await db
      .update(users)
      .set({ isGlobalAdmin: true })
      .where(eq(users.id, provisioned.userId));
  } else if (grantTenant) {
    await setSingleRole(grantTenant.id, provisioned.userId, role);
    await recordAudit({
      tenantId: grantTenant.id,
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

  await recordAudit({
    tenantId: null,
    actor: { userId: actor.id, email: actor.email },
    action: enable ? "admin.globalAdmin.grant" : "admin.globalAdmin.revoke",
    entityType: "user",
    entityId: userId,
    summary: `${enable ? "Granted" : "Revoked"} global admin for ${r[0].email}`,
    metadata: { targetEmail: r[0].email },
  });

  revalidatePath("/admin/access");
  return ok(enable ? "Global access granted." : "Global access revoked.");
}

const LAST_ADMIN =
  "This is the tenant's last admin — promote someone else first.";

/**
 * True when dropping this user's TENANT_ADMIN row would leave the tenant with
 * no admin at all — a state its own Access page cannot recover from, since
 * nobody left there can hand the role back.
 *
 * Shared by revoke and grant: setSingleRole deletes a user's existing rows for
 * the tenant before inserting the new one, so changing a role is a demotion
 * too, and both paths can orphan a tenant the same way.
 */
async function wouldOrphanTenant(
  tenantId: string,
  userId: string,
): Promise<boolean> {
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
  return isAdmin > 0 && (await adminCount(tenantId)) <= 1;
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

  // Promoting TO admin can never orphan the tenant; anything else is a
  // demotion of this user, so it has to clear the same bar as an outright
  // revoke. The tenant-scoped Access page guards this already.
  if (role !== "TENANT_ADMIN" && (await wouldOrphanTenant(tenantId, userId)))
    return fail(LAST_ADMIN);

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

  if (await wouldOrphanTenant(tenantId, userId)) return fail(LAST_ADMIN);

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

/**
 * Delete a person from the platform entirely: every tenant membership, the
 * app user row, and the Supabase Auth account. Historic records that mention
 * the id (audit log, match confirmations, signatures) are kept — they document
 * what happened, not who may sign in. You cannot delete yourself.
 */
export async function deleteUserAccount(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  if (!userId) return fail("Missing user.");
  if (userId === actor.id)
    return fail("You can't delete your own account from here.");

  // Before ANY row is removed. The clone shares production's user ids and its
  // auth project (spec/28 §5), so running this in homologation would delete a
  // real person's sign-in account — and refusing halfway would still have
  // stripped their roles from the clone.
  const blocked = authWriteBlockedReason("delete a sign-in account");
  if (blocked) return fail(blocked);

  const row = (
    await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) return fail("Unknown user.");

  await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  const admin = createSupabaseAdminClient({
    authWrite: "delete a sign-in account",
  });
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && !/not found/i.test(error.message)) {
    // The app rows are gone but the auth account lingers — surface it rather
    // than pretending; a retry (auth-only path) is safe.
    return fail(`App access removed, but the sign-in account could not be deleted: ${error.message}`);
  }

  await recordAudit({
    tenantId: null,
    actor: { userId: actor.id, email: actor.email },
    action: "admin.user.delete",
    entityType: "user",
    entityId: userId,
    summary: `Deleted platform account ${row.email}`,
    metadata: { targetEmail: row.email },
  });

  revalidatePath("/admin/access");
  return ok(`${row.email} deleted.`);
}

/**
 * (Re)send the set-your-password email — for fresh invites that never arrived
 * or expired links. Falls back with the reason when the project's email/
 * redirect configuration blocks it.
 */
export async function sendPasswordEmail(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { user: actor } = await requireGlobalAdmin();
  const userId = str(fd, "userId");
  const row = (
    await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) return fail("Unknown user.");

  const sent = await sendPasswordSetupEmail(row.email, await appOrigin(), {
    name: row.name,
  });
  if (!sent.sent) return fail(`Email not sent: ${sent.reason}.`);

  await recordAudit({
    tenantId: null,
    actor: { userId: actor.id, email: actor.email },
    action: "admin.user.passwordEmail",
    entityType: "user",
    entityId: userId,
    summary: `Sent a set-password email to ${row.email}`,
    metadata: { targetEmail: row.email },
  });
  return ok(`Password email sent to ${row.email}.`);
}

/** New one-time temporary password for an account (lost invite, etc.). */
export async function resetPassword(
  _prev: AddMemberState,
  fd: FormData,
): Promise<AddMemberState> {
  const { user: actor } = await requireGlobalAdmin();
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

  await recordAudit({
    tenantId: null,
    actor: { userId: actor.id, email: actor.email },
    action: "admin.user.passwordReset",
    entityType: "user",
    entityId: userId,
    summary: `Issued a temporary password for ${row.email}`,
    metadata: { targetEmail: row.email },
  });
  return {
    error: null,
    created: {
      email: row.email,
      tempPassword: r.tempPassword,
      note: "New temporary password set — share it once; they should change it after signing in.",
    },
  };
}
