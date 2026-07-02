// Competition results as CSV (public — results are public per spec/10).
import type { NextRequest } from "next/server";
import { listMatches } from "@/lib/competitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const matches = await listMatches(id);

  const header = [
    "matchNumber",
    "round",
    "teamA",
    "teamB",
    "status",
    "setsWonA",
    "setsWonB",
    "winner",
    "court",
    "scheduledAt",
  ];
  const lines = [header.join(",")];
  for (const m of matches) {
    lines.push(
      [
        m.matchNumber,
        m.roundName,
        m.teamAName,
        m.teamBName,
        m.status,
        m.setsWonA,
        m.setsWonB,
        m.winner === "A" ? m.teamAName : m.winner === "B" ? m.teamBName : "",
        m.courtNumber,
        m.scheduledAt ? new Date(m.scheduledAt).toISOString() : "",
      ]
        .map(cell)
        .join(","),
    );
  }

  // Once every match is finished the CSV is static — let the CDN absorb
  // spectator downloads; while play is ongoing, stay uncached.
  const allFinished =
    matches.length > 0 && matches.every((m) => m.status === "FINISHED");
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="results-${id}.csv"`,
      "Cache-Control": allFinished
        ? "public, s-maxage=300, stale-while-revalidate=3600"
        : "no-store",
    },
  });
}
