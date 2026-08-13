import Link from "next/link";
import { requireGlobalAdmin } from "@/lib/authz";
import { logout } from "@/lib/auth-actions";
import { ThemeToggle } from "@/components/ThemeToggle";

// Platform console (spec/23 §3.2). Global admins only; neutral platform
// styling on purpose — no tenant branding leaks in here. English-only: this
// surface is seen exclusively by platform operators, so it deliberately skips
// the i18n catalogue (unlike the tenant-facing switcher/picker, which are
// translated).
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireGlobalAdmin("/admin");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2 md:px-6 md:py-4">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="flex items-center gap-3">
            <span
              className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-fg"
              aria-hidden
            >
              ⚙
            </span>
            <span className="font-semibold">Platform admin</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              href="/admin"
              className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Tenants
            </Link>
            <Link
              href="/admin/access"
              className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              People
            </Link>
            <Link
              href="/admin/releases"
              className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Releases
            </Link>
            <Link
              href="/admin/backups"
              className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Backups
            </Link>
            <Link
              href="/admin/audit"
              className="rounded-lg px-3 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Audit
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
