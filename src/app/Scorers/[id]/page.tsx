import { notFound, redirect } from "next/navigation";
import { resolveMatchRoute } from "@/lib/match-route";

// Short URL (brief §5): /Scorers/{id} → the tenant-scoped live scorer page
// (which enforces admin auth + the per-match PIN).
export const dynamic = "force-dynamic";

export default async function ShortScorer({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await resolveMatchRoute(id);
  if (!r) notFound();
  redirect(
    `/t/${r.tenantSlug}/competitions/${r.competitionId}/matches/${id}/live`,
  );
}
