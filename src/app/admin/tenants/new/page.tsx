import Link from "next/link";
import { requireGlobalAdmin } from "@/lib/authz";
import { TenantCreateForm } from "@/components/admin/TenantCreateForm";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  await requireGlobalAdmin("/admin/tenants/new");

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New tenant</h1>
        <Link href="/admin" className={ui.btnSecondary}>
          ← Tenants
        </Link>
      </div>
      <TenantCreateForm />
    </main>
  );
}
