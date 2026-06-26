import { createSupabaseServerClient } from "@/lib/supabase";

// Upcoming surfaces — wired up in later phases (see spec/12-BUILD-ORDER.md).
const SECTIONS = [
  { title: "Competitions", note: "Create & manage competitions", phase: "Phase 3" },
  { title: "Matches", note: "Schedule and score matches", phase: "Phase 2+" },
  { title: "Scoreboard", note: "Public TV display", phase: "Phase 4" },
  { title: "Settings", note: "Branding & configuration", phase: "Phase 9" },
] as const;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-score-dim">
          {user?.email ? `Signed in as ${user.email}` : `Tenant: ${tenantSlug}`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => (
          <div
            key={s.title}
            className="rounded-xl border border-border bg-surface-raised p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{s.title}</h2>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-score-dim">
                {s.phase}
              </span>
            </div>
            <p className="mt-2 text-sm text-score-dim">{s.note}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
