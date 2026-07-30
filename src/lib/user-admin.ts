// Platform People console queries (global admin). Server-only.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants, users, userTenantRoles } from "@/db/schema";
import type { Role } from "@/lib/authz";

export interface PlatformUser {
  id: string;
  email: string;
  name: string | null;
  isGlobalAdmin: boolean;
  createdAt: Date;
  memberships: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    role: Role;
  }[];
}

/** Every account known to the platform, with global flag + memberships. */
export async function listAllUsers(): Promise<PlatformUser[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isGlobalAdmin: users.isGlobalAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.email));

  const memberships = await db
    .select({
      userId: userTenantRoles.userId,
      role: userTenantRoles.role,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(tenants.id, userTenantRoles.tenantId))
    .orderBy(asc(tenants.name));

  const byUser = new Map<string, PlatformUser>(
    rows.map((u) => [u.id, { ...u, memberships: [] }]),
  );
  for (const m of memberships) {
    byUser.get(m.userId)?.memberships.push({
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      tenantSlug: m.tenantSlug,
      role: m.role as Role,
    });
  }
  return [...byUser.values()];
}
