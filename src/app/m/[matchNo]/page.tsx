/**
 * The public board URL: `/m/27547` (spec/38).
 *
 * Short, stable and free of the scoring platform's tenant path, because this is
 * the link handed to competition staff and typed into venue browsers. VIS match
 * numbers are globally unique, so the number alone addresses a board; the
 * competition behind it is resolved here only to pick up its branding and to
 * keep the allowlist check.
 *
 * `/m/mock` renders the validation capture without touching VIS.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { competitionForMatch } from "@/lib/vis-live/resolve";
import {
  VisBoardScreen,
  type VisBoardQuery,
} from "@/components/scoreboard/VisBoardScreen";
import { MOCK_BOARD_TENANT, boardHostEnabled } from "@/lib/board-host";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Scoreboard",
  robots: { index: false, follow: false },
};

export default async function PublicBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchNo: string }>;
  searchParams: Promise<VisBoardQuery>;
}) {
  const { matchNo } = await params;
  const ref =
    matchNo === "mock"
      ? await MOCK_BOARD_TENANT()
      : /^\d{1,9}$/.test(matchNo)
        ? await competitionForMatch(Number(matchNo))
        : null;
  if (!ref) notFound();
  // Reachable from the scoring host too; harmless, and it keeps one URL shape
  // working everywhere while the board host is being set up.
  void boardHostEnabled;
  return (
    <VisBoardScreen
      tenantId={ref.tenantId}
      competitionId={ref.competitionId}
      rawMatchNo={matchNo}
      query={await searchParams}
    />
  );
}
