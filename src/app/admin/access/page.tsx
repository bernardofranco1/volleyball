import { requireGlobalAdmin } from "@/lib/authz";
import { listAllUsers } from "@/lib/user-admin";
import { listAllTenants } from "@/lib/tenant-admin";
import { AddPlatformUserForm } from "@/components/admin/AddPlatformUserForm";
import { PeopleList } from "@/components/admin/PeopleList";

export const dynamic = "force-dynamic";

// Platform People console (spec/23 addendum): who can reach the platform at
// all — global admins and every tenant membership — managed in one place.
// Tenant admins keep managing their own members on /t/{slug}/access.
export default async function AdminAccessPage() {
  const { user: me } = await requireGlobalAdmin("/admin/access");
  const [usersList, tenants] = await Promise.all([listAllUsers(), listAllTenants()]);
  const liveTenants = tenants
    .filter((t) => !t.deletedAt)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-score-dim">
          Everyone with platform access. Global admins control every tenant and
          this console; everyone else holds per-tenant roles, which tenant
          admins can also manage on their own Access page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <PeopleList
          people={usersList.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            isGlobalAdmin: u.isGlobalAdmin,
            memberships: u.memberships.map((m) => ({
              tenantId: m.tenantId,
              tenantName: m.tenantName,
              role: m.role,
            })),
          }))}
          tenants={liveTenants}
          meId={me.id}
        />
        <AddPlatformUserForm tenants={liveTenants} />
      </div>
    </main>
  );
}
