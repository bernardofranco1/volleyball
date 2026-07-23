// Match-report PDF (spec/10 §"PDF export"). PDFKit needs Node APIs + reads its
// AFM font metrics from disk, so this route is nodejs-only and `pdfkit` is a
// serverExternalPackage (see next.config.ts). Authorized to the match's tenant.

import type { NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { authorizeMatch, SCORING_ROLES } from "@/lib/authz";
import {
  type MatchReportData,
  MatchReportNotFound,
  type ReportEvent,
  isInterruption,
  loadMatchReport,
} from "@/lib/match-report";

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

  // ?type=log → the chronological event-log document (readable one-line-per-
  // event record, for protests/officiating); default → the match report.
  const variant = req.nextUrl.searchParams.get("type") === "log" ? "log" : "report";
  const pdf = variant === "log" ? await renderLogPdf(data) : await renderPdf(data);
  const filename = variant === "log" ? `match-${id}-log.pdf` : `match-${id}.pdf`;
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

// ── Event-log document (?type=log) ──────────────────────────────────────────
// One readable line per event, in match order, with the payload's who/why
// (team, reason, decision) spelled out — the record a referee reaches for in a
// protest. English-only like the report; player ids are not resolved here.

const NOISE_EVENTS = new Set(["MATCH_CREATED"]);

function describeLogEvent(
  e: ReportEvent,
  teamAName: string,
  teamBName: string,
): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const team = (v: unknown) =>
    v === "A" ? teamAName : v === "B" ? teamBName : "";
  switch (e.eventType) {
    case "RALLY_WON_A":
      return `Point — ${teamAName}`;
    case "RALLY_WON_B":
      return `Point — ${teamBName}`;
    case "REPLAY_POINT":
      return "Point replayed";
    case "COIN_TOSS":
      return `Coin toss — ${team(p.firstServer)} to serve`;
    case "MATCH_START":
      return "Match start";
    case "SET_START":
      return `Set ${p.setNumber ?? e.setNumber ?? ""} — start (${team(p.firstServer)} serves)`;
    case "SET_END":
      return `Set ${p.setNumber ?? e.setNumber ?? ""} — end (${team(p.winner)} ${p.scoreA}-${p.scoreB})`;
    case "MATCH_END":
      return `Match end — ${team(p.winner)} wins ${p.setsA}-${p.setsB}`;
    case "FORFEIT":
      return `${p.reason === "RETIREMENT" ? "Retirement" : "Forfeit"} — ${team(p.team)}`;
    case "SERVICE_ORDER":
      return `Service order declared — ${team(p.team)}`;
    case "LINEUP_CONFIRMED":
      return `Lineup confirmed — ${team(p.team) || "both teams"}`;
    case "TIMEOUT_REQUEST":
      return `Time-out — ${team(p.team)}`;
    case "TIMEOUT_END":
      return `Time-out over — ${team(p.team)}`;
    case "TTO_START":
      return "Technical time-out";
    case "TTO_END":
      return "Technical time-out over";
    case "MEDICAL_TIMEOUT":
      return `Medical time-out — ${team(p.team)}`;
    case "MEDICAL_TIMEOUT_END":
      return "Medical time-out over";
    case "SIDE_SWITCH":
      return "Court switch";
    case "SUBSTITUTION":
      return `Substitution — ${team(p.team)}`;
    case "LIBERO_REPLACEMENT":
      return `Libero ${p.direction === "OUT" ? "out" : "in"} — ${team(p.team)}`;
    case "LIBERO_REDESIGNATION":
      return `Libero re-designated — ${team(p.team)}`;
    case "VCS_CHALLENGE":
      return `Video challenge — ${team(p.team)}`;
    case "VCS_RESULT":
      return `Challenge ${p.upheld ? "upheld" : "rejected"} — ${team(p.team)}`;
    case "DELAY_WARNING":
      return `Delay warning — ${team(p.team)}`;
    case "DELAY_PENALTY":
      return `Delay penalty — ${team(p.team)}`;
    case "MISCONDUCT_WARNING":
      return `Misconduct warning — ${team(p.team)}`;
    case "MISCONDUCT_PENALTY":
      return `Misconduct penalty — ${team(p.team)}`;
    case "MISCONDUCT_EXPULSION":
      return `Expulsion — ${team(p.team)}`;
    case "MISCONDUCT_DISQUALIFICATION":
      return `Disqualification — ${team(p.team)}`;
    case "JUMP_SERVE_FOOT_FAULT":
      return `Serve foot fault — ${team(p.team)}`;
    case "ATTACK_ARC_FAULT":
      return `Attack arc fault — ${team(p.team)}`;
    case "NOTE":
      return `Note: ${typeof p.text === "string" ? p.text : (e.notes ?? "")}`;
    case "UNDO":
      return "Undo";
    case "REWIND":
      return "Admin rewind (events after this point erased)";
    default:
      return e.eventType.toLowerCase().replace(/_/g, " ");
  }
}

// Exported for tests (rendered with fabricated data — no DB needed).
export function renderLogPdf(data: MatchReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE.margin });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE.margin;
    const right = doc.page.width - PAGE.margin;
    const width = right - left;

    doc.fillColor(DIM).font("Helvetica-Bold").fontSize(14).text(data.tenantName);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(
      `Event log — ${data.teamAName} vs ${data.teamBName}`,
    );
    doc.fillColor(DIM).font("Helvetica").fontSize(10);
    doc.text(
      [data.competitionName, data.discipline, data.roundName]
        .filter(Boolean)
        .join("  ·  "),
    );
    doc.text(
      `Result: ${data.setsWonA}–${data.setsWonB}  ·  Played: ${fmtDateTime(data.startedAt)}`,
    );
    doc.moveDown(0.6);

    const cols = [
      { label: "#", w: 0.07 },
      { label: "Set", w: 0.07 },
      { label: "Score", w: 0.11 },
      { label: "Event", w: 0.47 },
      { label: "Actor", w: 0.12 },
      { label: "Time (UTC)", w: 0.16 },
    ];
    const visible = data.events.filter((e) => !NOISE_EVENTS.has(e.eventType));
    tableHeader(doc, left, width, cols);
    let lastSet: number | null = null;
    for (const e of visible) {
      if (e.setNumber != null && e.setNumber !== lastSet) {
        lastSet = e.setNumber;
        ensureSpace(doc, 22);
        doc.moveDown(0.3);
        doc
          .fillColor(INK)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(`Set ${e.setNumber}`, left, doc.y);
        doc.moveDown(0.2);
      }
      ensureSpace(doc, 16);
      tableRow(doc, left, width, cols, [
        String(e.sequence),
        e.setNumber != null ? String(e.setNumber) : "—",
        e.scoreAfterA != null && e.scoreAfterB != null
          ? `${e.scoreAfterA}–${e.scoreAfterB}`
          : "—",
        describeLogEvent(e, data.teamAName, data.teamBName),
        e.actor,
        new Date(e.timestamp).toUTCString().slice(17, 25),
      ]);
    }
    if (visible.length === 0) {
      doc.fillColor(DIM).font("Helvetica").fontSize(10).text("No events.");
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
