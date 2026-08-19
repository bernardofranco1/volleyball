/**
 * The VIS-fed broadcast board on its tenant path (spec/34). The screen itself
 * lives in VisBoardScreen, shared with the public board host's `/m/{matchNo}`
 * (spec/38); this route only resolves the tenant.
 */

import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import {
  VisBoardScreen,
  type VisBoardQuery,
} from "@/components/scoreboard/VisBoardScreen";

export const dynamic = "force-dynamic";

export default async function VisBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string; matchNo: string }>;
  searchParams: Promise<VisBoardQuery>;
}) {
  const { tenantSlug, competitionId, matchNo } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();
  return (
    <VisBoardScreen
      tenantId={tenant.id}
      competitionId={competitionId}
      rawMatchNo={matchNo}
      query={await searchParams}
    />
  );
}
