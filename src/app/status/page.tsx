/**
 * Public dependency status for the venue boards (spec/41).
 *
 * Server-rendered once so the page is useful on first paint even on a bad
 * connection, then kept current by the client — which also measures the one
 * thing no server can, whether THIS screen has a working connection.
 */

import type { Metadata } from "next";
import { readBoardStatus } from "@/lib/board-status";
import { StatusBoard } from "@/components/scoreboard/StatusBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scoreboard status",
  description: "Every dependency the venue boards rely on.",
  robots: { index: false, follow: false },
};

export default async function StatusPage() {
  // No live VIS call on the server render: the first paint reads the caches the
  // boards already fill, and the operator can probe on demand.
  const initial = await readBoardStatus({ origin: "", probe: false });
  return <StatusBoard initial={initial} />;
}
