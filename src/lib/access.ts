import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userTenantRoles } from "@/db/schema";
import type { Role } from "@/lib/authz";

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
}

// Higher = more privilege. Used to collapse a user with several role rows to a
// single displayed role (the UI grants exactly one role per person).
const RANK: Record<Role, number> = {
  TENANT_ADMIN: 4,
  COMPETITION_ADMIN: 3,
  SCORER: 2,
  VIEWER: 1,
};

/** People with access to a tenant, one row per user (highest role wins). */
export async function listMembers(tenantId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: userTenantRoles.userId,
      role: userTenantRoles.role,
      email: users.email,
      name: users.name,
    })
    .from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(eq(userTenantRoles.tenantId, tenantId));

  const byUser = new Map<string, Member>();
  for (const r of rows) {
    const role = r.role as Role;
    const prev = byUser.get(r.userId);
    if (!prev || RANK[role] > RANK[prev.role]) {
      byUser.set(r.userId, { userId: r.userId, email: r.email, name: r.name, role });
    }
  }
  return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** How many distinct people hold TENANT_ADMIN in a tenant (last-admin guard). */
export async function adminCount(tenantId: string): Promise<number> {
  const rows = await db
    .select({ userId: userTenantRoles.userId })
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.tenantId, tenantId),
        eq(userTenantRoles.role, "TENANT_ADMIN"),
      ),
    );
  return new Set(rows.map((r) => r.userId)).size;
}
