import { notFound, redirect } from "next/navigation";
import { resolveMatchRoute } from "@/lib/match-route";

// Short URL (brief §5): /Scoreboard/{id} → the tenant-scoped public board.
export const dynamic = "force-dynamic";

export default async function ShortScoreboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await resolveMatchRoute(id);
  if (!r) notFound();
  redirect(`/t/${r.tenantSlug}/scoreboard/${id}`);
}
