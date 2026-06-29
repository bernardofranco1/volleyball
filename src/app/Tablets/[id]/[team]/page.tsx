import { notFound, redirect } from "next/navigation";
import { resolveMatchRoute } from "@/lib/match-route";

// Short URL (brief §5): /Tablets/{id}/A → the tenant-scoped team-tablet page,
// preserving the ?token=… query the tablet needs.
export const dynamic = "force-dynamic";

export default async function ShortTablet({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; team: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id, team } = await params;
  const { token } = await searchParams;
  const t = team.toUpperCase() === "B" ? "B" : "A";
  const r = await resolveMatchRoute(id);
  if (!r) notFound();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  redirect(`/t/${r.tenantSlug}/matches/${id}/team/${t}${qs}`);
}
