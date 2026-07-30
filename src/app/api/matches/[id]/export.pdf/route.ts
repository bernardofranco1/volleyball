// Match-report PDF (spec/10 §"PDF export"). PDFKit needs Node APIs + reads its
// AFM font metrics from disk, so this route is nodejs-only and `pdfkit` is a
// serverExternalPackage (see next.config.ts). Authorized to the match's tenant.

import type { NextRequest } from "next/server";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import {
  type MatchReportData,
  MatchReportNotFound,
  loadMatchReport,
} from "@/lib/match-report";
import { renderLogPdf, renderPdf } from "@/lib/match-report-pdf";
import { renderScoresheetPdf } from "@/lib/scoresheet-pdf";
import { resolveMatchConfig } from "@/lib/match-engine";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // The report exposes rosters/results — restrict to the match's tenant members
  // (spec/14 §A1), not any authenticated user.
  const authed = await authorizeMatch(id, SCORING_ROLES);
  if (!authed.ok)
    return Response.json({ error: "Forbidden" }, { status: authed.status });

  let data: MatchReportData;
  try {
    data = await loadMatchReport(id);
  } catch (err) {
    if (err instanceof MatchReportNotFound)
      return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }

  // ?type=official → the FIVB-style official scoresheet replica (spec/21,
  // indoor + beach; other disciplines fall back to the block-structure sheet);
  // ?type=sheet → the block-structure scoresheet (spec/20); ?type=log → the
  // chronological event-log record (for protests); default → internal report.
  const typeParam = req.nextUrl.searchParams.get("type");
  const variant =
    typeParam === "log"
      ? "log"
      : typeParam === "official"
        ? "official"
        : typeParam === "sheet"
          ? "sheet"
          : "report";
  let pdf: Buffer;
  if (variant === "official") {
    const config = await resolveMatchConfig(id);
    const sheetData = buildOfficialSheetData(data);
    pdf =
      data.discipline === "BEACH"
        ? await renderBeachOfficialPdf(data, sheetData, config)
        : data.discipline === "INDOOR"
          ? await renderIndoorOfficialPdf(data, sheetData, config)
          : await renderScoresheetPdf(data);
  } else {
    pdf =
      variant === "log"
        ? await renderLogPdf(data)
        : variant === "sheet"
          ? await renderScoresheetPdf(data)
          : await renderPdf(data);
  }
  const filename =
    variant === "log"
      ? `match-${id}-log.pdf`
      : variant === "official"
        ? `official-scoresheet-${id}.pdf`
        : variant === "sheet"
          ? `scoresheet-${id}.pdf`
          : `match-${id}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
