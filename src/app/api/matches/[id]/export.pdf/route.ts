// Match-report PDF (spec/10 §"PDF export"). PDFKit needs Node APIs + reads its
// AFM font metrics from disk, so this route is nodejs-only and `pdfkit` is a
// serverExternalPackage (see next.config.ts). Requires an authenticated user.

import type { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { createSupabaseServerClient } from "@/lib/supabase";
import {
  type MatchReportData,
  MatchReportNotFound,
  isInterruption,
  loadMatchReport,
} from "@/lib/match-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let data: MatchReportData;
  try {
    data = await loadMatchReport(id);
  } catch (err) {
    if (err instanceof MatchReportNotFound)
      return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }

  const pdf = await renderPdf(data);
  const filename = `match-${id}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────

const PAGE = { margin: 50 };
const INK = "#111111";
const DIM = "#666666";
const RULE = "#cccccc";

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toUTCString();
}

function duration(data: MatchReportData): string {
  const start = data.startedAt ? new Date(data.startedAt).getTime() : null;
  const endSource =
    data.finishedAt ??
    [...data.sets].reverse().find((s) => s.endedAt)?.endedAt ??
    null;
  const end = endSource ? new Date(endSource).getTime() : null;
  if (start == null || end == null || end < start) return "—";
  const secs = Math.floor((end - start) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function renderPdf(data: MatchReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE.margin });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE.margin;
    const right = doc.page.width - PAGE.margin;
    const width = right - left;

    const heading = (text: string) => {
      ensureSpace(doc, 40);
      doc.moveDown(0.8);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(text);
      doc
        .moveTo(left, doc.y + 2)
        .lineTo(right, doc.y + 2)
        .strokeColor(RULE)
        .stroke();
      doc.moveDown(0.4);
    };

    // ── Header ────────────────────────────────────────────────────────────
    doc.fillColor(DIM).font("Helvetica-Bold").fontSize(16).text(data.tenantName);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(
      data.competitionName,
    );
    doc.fillColor(DIM).font("Helvetica").fontSize(10);
    const meta = [
      data.discipline,
      data.roundName,
      data.courtNumber != null ? `Court ${data.courtNumber}` : null,
      data.status,
    ]
      .filter(Boolean)
      .join("  ·  ");
    doc.text(meta);
    doc.text(`Scheduled: ${fmtDateTime(data.scheduledAt)}`);
    doc.text(
      `Played: ${fmtDateTime(data.startedAt)} — ${fmtDateTime(data.finishedAt)}`,
    );

    doc.moveDown(0.8);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(
      `${data.teamAName}   vs   ${data.teamBName}`,
      { align: "center" },
    );
    const winnerName =
      data.winner === "A"
        ? data.teamAName
        : data.winner === "B"
          ? data.teamBName
          : null;
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(`${data.setsWonA} – ${data.setsWonB}`, { align: "center" });
    doc.fillColor(DIM).font("Helvetica").fontSize(11).text(
      winnerName ? `Winner: ${winnerName}  ·  Duration: ${duration(data)}` : `Duration: ${duration(data)}`,
      { align: "center" },
    );

    // ── Set scores ────────────────────────────────────────────────────────
    heading("Set scores");
    if (data.sets.length === 0) {
      doc.fillColor(DIM).font("Helvetica").fontSize(10).text("No set data.");
    } else {
      const cols = [
        { label: "Set", w: 0.15 },
        { label: data.teamAName, w: 0.3 },
        { label: data.teamBName, w: 0.3 },
        { label: "Winner", w: 0.25 },
      ];
      tableHeader(doc, left, width, cols);
      for (const s of data.sets) {
        ensureSpace(doc, 18);
        tableRow(doc, left, width, cols, [
          String(s.setNumber),
          String(s.scoreA),
          String(s.scoreB),
          s.winner === "A"
            ? data.teamAName
            : s.winner === "B"
              ? data.teamBName
              : "—",
        ]);
      }
    }

    // ── Game interruptions / sanctions ──────────────────────────────────────
    heading("Game interruptions & sanctions");
    const interruptions = data.events.filter((e) => isInterruption(e.eventType));
    if (interruptions.length === 0) {
      doc.fillColor(DIM).font("Helvetica").fontSize(10).text("None recorded.");
    } else {
      const cols = [
        { label: "Set", w: 0.1 },
        { label: "Score", w: 0.18 },
        { label: "Type", w: 0.42 },
        { label: "Time (UTC)", w: 0.3 },
      ];
      tableHeader(doc, left, width, cols);
      for (const e of interruptions) {
        ensureSpace(doc, 18);
        tableRow(doc, left, width, cols, [
          e.setNumber != null ? String(e.setNumber) : "—",
          e.scoreAfterA != null && e.scoreAfterB != null
            ? `${e.scoreAfterA}–${e.scoreAfterB}`
            : "—",
          e.eventType,
          new Date(e.timestamp).toUTCString().slice(17, 25),
        ]);
      }
    }

    // ── Full event log ──────────────────────────────────────────────────────
    heading("Event log");
    if (data.events.length === 0) {
      doc.fillColor(DIM).font("Helvetica").fontSize(10).text("No events.");
    } else {
      const cols = [
        { label: "#", w: 0.08 },
        { label: "Event", w: 0.34 },
        { label: "Set", w: 0.1 },
        { label: "Score", w: 0.18 },
        { label: "Actor", w: 0.3 },
      ];
      tableHeader(doc, left, width, cols);
      for (const e of data.events) {
        ensureSpace(doc, 16);
        tableRow(doc, left, width, cols, [
          String(e.sequence),
          e.eventType,
          e.setNumber != null ? String(e.setNumber) : "—",
          e.scoreAfterA != null && e.scoreAfterB != null
            ? `${e.scoreAfterA}–${e.scoreAfterB}`
            : "—",
          e.actor,
        ]);
      }
    }

    doc.end();
  });
}

type Col = { label: string; w: number };

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const bottom = doc.page.height - PAGE.margin;
  if (doc.y + needed > bottom) doc.addPage();
}

function tableHeader(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  cols: Col[],
) {
  ensureSpace(doc, 24);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DIM);
  let x = left;
  const y = doc.y;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x + 2, y, {
      width: width * c.w - 4,
      ellipsis: true,
    });
    x += width * c.w;
  }
  doc.y = y + 14;
  doc
    .moveTo(left, doc.y - 3)
    .lineTo(left + width, doc.y - 3)
    .strokeColor(RULE)
    .stroke();
}

function tableRow(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  cols: Col[],
  cells: string[],
) {
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  let x = left;
  const y = doc.y;
  cols.forEach((c, i) => {
    doc.text(cells[i] ?? "", x + 2, y, {
      width: width * c.w - 4,
      ellipsis: true,
      lineBreak: false,
    });
    x += width * c.w;
  });
  doc.y = y + 14;
}
