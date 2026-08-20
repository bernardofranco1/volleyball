import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, tenants } from "@/db/schema";
import { tournamentOfMatch } from "@/lib/vis-live/store";

// Short URL by VIS MATCH NUMBER alone (spec/34): /Scoreboard/vis/28803 → the
// board, with query params (?layout=ushape, ?screen=…, ?bg=…, ?window=…)
// passed through. Resolvable because VIS match numbers are globally unique and
// the allowlist maps them to their tournament; the tournament maps to exactly
// one VIS-linked competition here.
export const dynamic = "force-dynamic";

export default async function ShortVisBoard({
  params,
  searchParams,
}: {
  params: Promise<{ matchNo: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { matchNo } = await params;
  const query = await searchParams;
  // The validation mock (spec/35 W9) and the replay board (spec/44) hang off
  // the U17 competition so they have a tenant and branding, but their data
  // comes from an embedded capture and never from VIS.
  const synthetic = matchNo === "mock" || matchNo === "replay";
  if (!synthetic && !/^\d{1,9}$/.test(matchNo)) notFound();

  const tournamentNo = synthetic
    ? 1670
    : await tournamentOfMatch(Number(matchNo)).catch(() => null);
  if (tournamentNo == null) notFound();

  const rows = await db
    .select({ competitionId: competitions.id, tenantSlug: tenants.slug })
    .from(competitions)
    .innerJoin(tenants, eq(tenants.id, competitions.tenantId))
    .where(eq(competitions.visTournamentNo, tournamentNo))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string") qs.set(k, v);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  redirect(
    `/t/${row.tenantSlug}/scoreboard/vis/${row.competitionId}/${matchNo}${suffix}`,
  );
}
