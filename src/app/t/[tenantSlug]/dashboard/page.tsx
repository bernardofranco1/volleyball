import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getT } from "@/lib/i18n/server";

// Tenant surfaces. `href` links to a shipped section; `titleKey`/`noteKey` are
// i18n message keys resolved per the tenant's chosen locale.
const SECTIONS = [
  { titleKey: "nav.competitions", noteKey: "dashboard.competitions", href: "competitions" },
  { titleKey: "nav.matches", noteKey: "dashboard.matches", href: "competitions" },
  { titleKey: "nav.scoreboard", noteKey: "dashboard.scoreboard" },
  { titleKey: "nav.settings", noteKey: "dashboard.settings", href: "settings" },
] as const;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { t } = await getT();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="mt-1 text-sm text-score-dim">
          {user?.email
            ? `${t("dashboard.signedInAs")} ${user.email}`
            : `Tenant: ${tenantSlug}`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => {
          const href = "href" in s ? s.href : undefined;
          const className =
            "rounded-xl border border-border bg-surface-raised p-5" +
            (href ? " block transition-colors hover:border-primary" : "");
          const inner = (
            <>
              <h2 className="font-medium">{t(s.titleKey)}</h2>
              <p className="mt-2 text-sm text-score-dim">{t(s.noteKey)}</p>
            </>
          );
          return href ? (
            <Link
              key={s.titleKey}
              href={`/t/${tenantSlug}/${href}`}
              className={className}
            >
              {inner}
            </Link>
          ) : (
            <div key={s.titleKey} className={className}>
              {inner}
            </div>
          );
        })}
      </div>
    </main>
  );
}
