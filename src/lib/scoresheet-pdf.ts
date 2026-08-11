/**
 * Official scoresheet export (spec/20). Modelled on the two reference documents:
 * the *FIVB Beach Volleyball International Scoresheet* and the FIVB indoor sheet
 * (VSR 3.16). It reproduces the sheet's BLOCK STRUCTURE and its official wording
 * — header, TEAMS, per-set record, RESULTS, SANCTIONS, REMARKS, APPROVAL — in
 * landscape A4, so a referee reading it recognises the document.
 *
 * What it is not: a pixel clone of the paper grid. The per-rally point-run matrix
 * (the long numbered strips where each point is struck through) is a separate
 * build; every rally IS in the event log, so it can be added later without any
 * data work.
 *
 * Signature handling is the point of the exercise: each signature lives inside
 * its OWN bordered box, drawn with the box as a clipping region and the ink
 * letterboxed into it (`fitStrokes`), so no signature can ever run over a
 * neighbouring cell and cost the sheet its legibility.
 */

import PDFDocument from "pdfkit";
import { fitStrokes, type SignatureStrokes } from "@/lib/match-signatures";
import type { MatchReportData, ReportPlayer } from "@/lib/match-report";
import { isInterruption } from "@/lib/match-report";

const INK = "#111111";
const DIM = "#5b5b5b";
const RULE = "#9a9a9a";
const FILL = "#eef1f5";

const M = 24; // page margin
const ROW = 13; // standard table row height

interface Ctx {
  doc: PDFKit.PDFDocument;
  left: number;
  right: number;
  width: number;
}

export function renderScoresheetPdf(data: MatchReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: M });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = M;
    const right = doc.page.width - M;
    const ctx: Ctx = { doc, left, right, width: right - left };

    header(ctx, data);
    teamsBlock(ctx, data);
    setRecord(ctx, data);
    ensure(ctx, 150);
    const y = doc.y + 6;
    // Results and sanctions/remarks sit side by side, as on the paper sheet.
    const colW = (ctx.width - 10) / 2;
    const resultsBottom = resultsBlock(ctx, data, left, y, colW);
    const remarksBottom = sanctionsAndRemarks(ctx, data, left + colW + 10, y, colW);
    doc.y = Math.max(resultsBottom, remarksBottom) + 8;
    interruptionsBlock(ctx, data);
    approvalBlock(ctx, data);
    footer(ctx, data);

    doc.end();
  });
}

// ── building blocks ─────────────────────────────────────────────────────────

/** Space left on the page above the footer strip. */
function remaining({ doc }: Ctx): number {
  return doc.page.height - M - 16 - doc.y;
}

/**
 * Start a new page if `h` will not fit. Blocks are drawn at absolute
 * coordinates, so without this a long indoor sheet (12-player rosters, five
 * sets) would simply run off the bottom edge instead of paginating.
 */
function ensure(ctx: Ctx, h: number) {
  if (remaining(ctx) < h) {
    ctx.doc.addPage();
    ctx.doc.y = M;
  }
}

/** Bordered box with a small uppercase caption; returns the inner content top. */
function box(
  { doc }: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  caption?: string,
): number {
  doc.save().lineWidth(0.7).strokeColor(RULE).rect(x, y, w, h).stroke().restore();
  if (!caption) return y + 3;
  doc.save();
  doc
    .rect(x, y, w, 12)
    .fillColor(FILL)
    .fill()
    .lineWidth(0.7)
    .strokeColor(RULE)
    .rect(x, y, w, 12)
    .stroke();
  doc
    .fillColor(DIM)
    .font("Helvetica-Bold")
    .fontSize(6.5)
    .text(caption.toUpperCase(), x + 4, y + 3.5, { width: w - 8, ellipsis: true });
  doc.restore();
  return y + 15;
}

/** "Label: value" pair inside a captioned strip. */
function field(
  { doc }: Ctx,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
) {
  doc.fillColor(DIM).font("Helvetica").fontSize(6.5).text(label.toUpperCase(), x, y, {
    width: w,
    ellipsis: true,
  });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(value || "—", x, y + 7.5, { width: w, ellipsis: true, lineBreak: false });
}

function fmtTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(11, 19);
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

function durationOf(from: string | Date | null, to: string | Date | null): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

const DISCIPLINE_TITLE: Record<string, string> = {
  BEACH: "BEACH VOLLEYBALL INTERNATIONAL SCORESHEET",
  INDOOR: "VOLLEYBALL INTERNATIONAL SCORESHEET",
  GRASS: "GRASS VOLLEYBALL SCORESHEET",
  LIGHT: "LIGHT / AIR VOLLEYBALL SCORESHEET",
};

// ── header ──────────────────────────────────────────────────────────────────

function header(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(DISCIPLINE_TITLE[data.discipline] ?? "VOLLEYBALL SCORESHEET", left, M, {
      width: width - 150,
    });
  const sets = data.sets.length;
  doc
    .fillColor(DIM)
    .font("Helvetica")
    .fontSize(8)
    .text(
      `Rally Point System · ${sets} set${sets === 1 ? "" : "s"} played`,
      left,
      doc.y + 1,
    );
  doc
    .fillColor(DIM)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(data.tenantName, left, M + 2, { width, align: "right" });

  const y = M + 30;
  // Tall enough for the two fields that legitimately wrap onto a second line
  // (competition name, site/hall) — a value must never cross its own border.
  const top = box(ctx, left, y, width, 44);
  const cols = [
    ["Competition", data.competitionName],
    ["Match No.", data.matchNumber != null ? String(data.matchNumber) : "—"],
    ["Date", fmtDate(data.scheduledAt ?? data.startedAt)],
    ["Site / hall", data.venue ?? "—"],
    ["Court", data.courtNumber != null ? String(data.courtNumber) : "—"],
    ["Gender", genderLabel(data.gender)],
    ["Phase", data.phaseName ?? "—"],
    ["Round", data.roundName ?? "—"],
  ] as const;
  // The competition name gets a double share of the width.
  const unit = (width - 16) / 9;
  let x = left + 8;
  cols.forEach(([label, value], i) => {
    const w = i === 0 ? unit * 2 : unit;
    field(ctx, x, top + 1, w - 6, label, value);
    x += w;
  });
  doc.y = y + 48;
}

function genderLabel(g: string | null): string {
  // Schema enum is MEN/WOMEN/MIXED (src/lib/domain.ts) — the old MALE/FEMALE
  // checks printed "—" for every real match (spec/21 bug fix).
  if (g === "MEN" || g === "MALE") return "M";
  if (g === "WOMEN" || g === "FEMALE") return "F";
  if (g === "MIXED") return "Mixed";
  return "—";
}

// ── teams + rosters ─────────────────────────────────────────────────────────

function teamsBlock(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  const y = doc.y;
  const half = (width - 10) / 2;
  // Two columns per team once a roster is longer than six — an indoor sheet
  // carries up to 14 names and must not push the rest of the document off-page.
  const longest = Math.max(data.rosterA.length, data.rosterB.length, 2);
  const perCol = longest > 6 ? Math.ceil(longest / 2) : longest;
  const twoCol = perCol < longest;
  const h = 15 + 9 + perCol * ROW + 4;
  ensure(ctx, h + 6);

  const sides: [string, ReportPlayer[], number][] = [
    [`A — ${data.teamAName}`, data.rosterA, left],
    [`B — ${data.teamBName}`, data.rosterB, left + half + 10],
  ];
  for (const [caption, roster, x] of sides) {
    const top = box(ctx, x, y, half, h, caption);
    const colW = twoCol ? (half - 12) / 2 : half - 12;
    const nameW = colW - 34 - 46;
    doc.fillColor(DIM).font("Helvetica-Bold").fontSize(6.5);
    for (let c = 0; c < (twoCol ? 2 : 1); c++) {
      const cx = x + 6 + c * colW;
      doc.text("NO.", cx, top, { width: 24 });
      doc.text("NAME", cx + 28, top, { width: nameW });
      doc.text("ROLE", cx + 28 + nameW + 4, top, { width: 42 });
    }
    if (roster.length === 0) {
      doc
        .fillColor(DIM)
        .font("Helvetica")
        .fontSize(8)
        .text("No roster recorded.", x + 6, top + 9);
    }
    roster.forEach((p, i) => {
      const col = twoCol ? Math.floor(i / perCol) : 0;
      const cx = x + 6 + col * colW;
      const ry = top + 9 + (i - col * perCol) * ROW;
      doc.fillColor(INK).font("Helvetica").fontSize(8.5);
      doc.text(p.jerseyNumber != null ? String(p.jerseyNumber) : "—", cx, ry, {
        width: 24,
      });
      doc.text(p.jerseyName, cx + 28, ry, {
        width: nameW,
        ellipsis: true,
        lineBreak: false,
      });
      doc
        .fillColor(DIM)
        .fontSize(7)
        .text(
          [p.isCaptain ? "Capt." : null, p.isLibero ? "Libero" : null]
            .filter(Boolean)
            .join(" "),
          cx + 28 + nameW + 4,
          ry,
          { width: 42, ellipsis: true, lineBreak: false },
        );
    });
  }
  doc.y = y + h + 8;
}

// ── per-set record ──────────────────────────────────────────────────────────

function setRecord(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  const rows = Math.max(data.sets.length, 1);
  const h = 15 + 10 + rows * ROW + 4;
  ensure(ctx, h + 6);
  const y = doc.y;
  const top = box(ctx, left, y, width, h, "Set record");

  const cols: [string, number][] = [
    ["Set", 0.06],
    ["Start", 0.1],
    ["End", 0.1],
    ["Duration", 0.1],
    [`${trim(data.teamAName)} pts`, 0.13],
    [`${trim(data.teamBName)} pts`, 0.13],
    ["Winner", 0.14],
    ["T/O A", 0.07],
    ["T/O B", 0.07],
    ["TTO", 0.1],
  ];
  const xs: number[] = [];
  let x = left + 6;
  for (const [, frac] of cols) {
    xs.push(x);
    x += frac * (width - 12);
  }
  doc.fillColor(DIM).font("Helvetica-Bold").fontSize(6.5);
  cols.forEach(([label], i) =>
    doc.text(label.toUpperCase(), xs[i], top, {
      width: cols[i][1] * (width - 12) - 4,
      ellipsis: true,
      lineBreak: false,
    }),
  );
  let ry = top + 10;
  if (data.sets.length === 0) {
    doc.fillColor(DIM).font("Helvetica").fontSize(8).text("No sets recorded.", xs[0], ry);
  }
  for (const s of data.sets) {
    const cells = [
      String(s.setNumber),
      fmtTime(s.startedAt),
      fmtTime(s.endedAt),
      durationOf(s.startedAt, s.endedAt),
      String(s.scoreA),
      String(s.scoreB),
      s.winner === "A" ? trim(data.teamAName) : s.winner === "B" ? trim(data.teamBName) : "—",
      String(s.timeoutsUsedA),
      String(s.timeoutsUsedB),
      s.ttoFired ? "yes" : "—",
    ];
    doc.fillColor(INK).font("Helvetica").fontSize(8.5);
    cells.forEach((c, i) =>
      doc.text(c, xs[i], ry, {
        width: cols[i][1] * (width - 12) - 4,
        ellipsis: true,
        lineBreak: false,
      }),
    );
    ry += ROW;
  }
  doc.y = y + h;
}

function trim(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

// ── results ─────────────────────────────────────────────────────────────────

function resultsBlock(
  ctx: Ctx,
  data: MatchReportData,
  x: number,
  y: number,
  w: number,
): number {
  const { doc } = ctx;
  const h = 15 + 10 + (data.sets.length + 3) * ROW + 6;
  const top = box(ctx, x, y, w, h, "Results");

  const colW = (w - 12) / 5;
  const heads = ["", trim(data.teamAName), trim(data.teamBName), "Duration", "Winner"];
  doc.fillColor(DIM).font("Helvetica-Bold").fontSize(6.5);
  heads.forEach((hd, i) =>
    doc.text(hd.toUpperCase(), x + 6 + i * colW, top, { width: colW - 4, ellipsis: true, lineBreak: false }),
  );
  let ry = top + 10;
  for (const s of data.sets) {
    const cells = [
      `Set ${s.setNumber}`,
      String(s.scoreA),
      String(s.scoreB),
      durationOf(s.startedAt, s.endedAt),
      s.winner === "A" ? "A" : s.winner === "B" ? "B" : "—",
    ];
    doc.fillColor(INK).font("Helvetica").fontSize(8.5);
    cells.forEach((c, i) =>
      doc.text(c, x + 6 + i * colW, ry, { width: colW - 4, ellipsis: true, lineBreak: false }),
    );
    ry += ROW;
  }
  // Totals — points across all sets, then sets won.
  const ptsA = data.sets.reduce((n, s) => n + s.scoreA, 0);
  const ptsB = data.sets.reduce((n, s) => n + s.scoreB, 0);
  doc.save().lineWidth(0.5).strokeColor(RULE);
  doc.moveTo(x + 6, ry - 2).lineTo(x + w - 6, ry - 2).stroke();
  doc.restore();
  const totals: [string, string, string, string, string][] = [
    ["Total points", String(ptsA), String(ptsB), durationOf(data.startedAt, data.finishedAt), ""],
    ["Sets won", String(data.setsWonA), String(data.setsWonB), "", ""],
  ];
  for (const row of totals) {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5);
    row.forEach((c, i) =>
      doc.text(c, x + 6 + i * colW, ry, { width: colW - 4, ellipsis: true, lineBreak: false }),
    );
    ry += ROW;
  }
  const winner =
    data.winner === "A" ? data.teamAName : data.winner === "B" ? data.teamBName : null;
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(
      winner
        ? `Winning team: ${winner}  ${data.setsWonA}:${data.setsWonB}`
        : "Winning team: —",
      x + 6,
      ry,
      { width: w - 12, ellipsis: true },
    );
  doc
    .fillColor(DIM)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      `Match start ${fmtTime(data.startedAt)} · end ${fmtTime(data.finishedAt)} · total ${durationOf(data.startedAt, data.finishedAt)} (UTC)`,
      x + 6,
      ry + 11,
      { width: w - 12, ellipsis: true },
    );
  return y + h;
}

// ── sanctions + remarks ─────────────────────────────────────────────────────

const SANCTION_TYPES = new Set([
  "DELAY_WARNING",
  "DELAY_PENALTY",
  "MISCONDUCT_WARNING",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
  "FORFEIT",
]);

function sanctionsAndRemarks(
  ctx: Ctx,
  data: MatchReportData,
  x: number,
  y: number,
  w: number,
): number {
  const { doc } = ctx;
  const sanctions = data.events.filter((e) => SANCTION_TYPES.has(e.eventType));
  const interruptions = data.events.filter(
    (e) => isInterruption(e.eventType) && !SANCTION_TYPES.has(e.eventType),
  );
  const remarks = data.approval.signatures.filter((s) => s.remarks);
  void interruptions; // listed in their own block below

  const sh = 15 + Math.max(sanctions.length, 1) * ROW + 6;
  const top = box(ctx, x, y, w, sh, "Sanctions");
  let ry = top;
  if (sanctions.length === 0) {
    doc.fillColor(DIM).font("Helvetica").fontSize(8).text("None.", x + 6, ry);
  }
  for (const e of sanctions) {
    const team = (e.payload as { team?: string } | null)?.team;
    doc
      .fillColor(INK)
      .font("Helvetica")
      .fontSize(8.5)
      .text(
        `${e.eventType.replace(/_/g, " ").toLowerCase()}${team ? ` — team ${team}` : ""} · set ${e.setNumber ?? "—"} · ${e.scoreAfterA ?? "?"}-${e.scoreAfterB ?? "?"} · ${fmtTime(e.timestamp)}`,
        x + 6,
        ry,
        { width: w - 12, ellipsis: true, lineBreak: false },
      );
    ry += ROW;
  }

  const ry2 = y + sh + 6;
  const rh = 15 + Math.max(remarks.length + 1, 2) * ROW + 6;
  const top2 = box(ctx, x, ry2, w, rh, "Remarks");
  let ry3 = top2;
  if (remarks.length === 0) {
    doc
      .fillColor(DIM)
      .font("Helvetica")
      .fontSize(8)
      .text("None.", x + 6, ry3, { width: w - 12, ellipsis: true });
  }
  for (const s of remarks) {
    doc
      .fillColor(INK)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${s.signerName}${s.intent === "PROTEST" ? " (under protest)" : s.intent === "REFUSED" ? " (refused to sign)" : ""}: ${s.remarks}`,
        x + 6,
        ry3,
        { width: w - 12, ellipsis: true },
      );
    ry3 += ROW;
  }
  return ry2 + rh;
}

// ── game interruptions (time-outs, technical time-outs, court switches) ─────

/** How many rows fit before the approval block; the rest are cross-referenced. */
const MAX_INTERRUPTION_ROWS = 8;

function interruptionsBlock(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  const all = data.events.filter(
    (e) => isInterruption(e.eventType) && !SANCTION_TYPES.has(e.eventType),
  );

  // Rows this block would like, and the room the approval block must keep — the
  // signature squares are the legal part of the sheet and are never split.
  const want = Math.min(MAX_INTERRUPTION_ROWS, Math.max(all.length, 1));
  const reserve = 15 + 19 + 74 + 14 + 10;
  const chrome = 15 + 10 + 4;
  const roomFor = () =>
    Math.max(0, Math.floor((remaining(ctx) - reserve - chrome - ROW) / ROW));
  // If barely anything fits, give the block a fresh page rather than truncating
  // it to nothing (which used to print "none recorded" over the overflow note).
  if (all.length > 0 && roomFor() < Math.min(3, all.length)) {
    doc.addPage();
    doc.y = M;
  }
  const shown = all.slice(0, Math.min(want, Math.max(roomFor(), 0)));
  const overflow = all.length - shown.length;

  const rows = Math.max(shown.length, 1) + (overflow > 0 ? 1 : 0);
  const h = chrome + 10 + rows * ROW;
  const y = doc.y;
  const top = box(ctx, left, y, width, h, "Game interruptions & court switches");

  const cols: [string, number][] = [
    ["Set", 0.06],
    ["Score", 0.1],
    ["Type", 0.34],
    ["Team", 0.1],
    ["Time (UTC)", 0.14],
    ["Seq.", 0.08],
  ];
  const xs: number[] = [];
  let x = left + 6;
  for (const [, frac] of cols) {
    xs.push(x);
    x += frac * (width - 12);
  }
  doc.fillColor(DIM).font("Helvetica-Bold").fontSize(6.5);
  cols.forEach(([label], i) =>
    doc.text(label.toUpperCase(), xs[i], top, {
      width: cols[i][1] * (width - 12) - 4,
      ellipsis: true,
      lineBreak: false,
    }),
  );
  let ry = top + 10;
  // Exclusive branches: "none recorded" is only true when there is nothing at all.
  if (all.length === 0) {
    doc.fillColor(DIM).font("Helvetica").fontSize(8).text("None recorded.", xs[0], ry);
  }
  for (const e of shown) {
    const team = (e.payload as { team?: string } | null)?.team ?? "—";
    const cells = [
      e.setNumber != null ? String(e.setNumber) : "—",
      e.scoreAfterA != null && e.scoreAfterB != null
        ? `${e.scoreAfterA}-${e.scoreAfterB}`
        : "—",
      e.eventType.replace(/_/g, " ").toLowerCase(),
      team,
      fmtTime(e.timestamp),
      String(e.sequence),
    ];
    doc.fillColor(INK).font("Helvetica").fontSize(8.5);
    cells.forEach((c, i) =>
      doc.text(c, xs[i], ry, {
        width: cols[i][1] * (width - 12) - 4,
        ellipsis: true,
        lineBreak: false,
      }),
    );
    ry += ROW;
  }
  if (overflow > 0) {
    doc
      .fillColor(DIM)
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .text(
        `+ ${overflow} more interruption${overflow === 1 ? "" : "s"} — complete chronological record in the event-log export.`,
        xs[0],
        ry,
        { width: width - 16, ellipsis: true, lineBreak: false },
      );
  }
  doc.y = y + h + 8;
}

// ── approval: signatures, each inside its own box ───────────────────────────

/** Draw one signature clipped to its box, letterboxed so it is never stretched. */
export function drawSignatureInBox(
  doc: PDFKit.PDFDocument,
  strokes: SignatureStrokes | null,
  box: { x: number; y: number; w: number; h: number },
) {
  if (!strokes || strokes.strokes.length === 0) return;
  const polylines = fitStrokes(strokes, box);
  doc.save();
  // Clip to the box: even a malformed payload cannot bleed into the cell next to
  // it, which is what keeps the rest of the sheet legible.
  doc.rect(box.x, box.y, box.w, box.h).clip();
  doc.lineWidth(1).strokeColor(INK).lineJoin("round").lineCap("round");
  for (const line of polylines) {
    if (line.length === 0) continue;
    doc.moveTo(line[0][0], line[0][1]);
    if (line.length === 1) doc.lineTo(line[0][0] + 0.7, line[0][1]);
    else for (const p of line.slice(1)) doc.lineTo(p[0], p[1]);
    doc.stroke();
  }
  doc.restore();
}

/** Aspect ratio of the on-screen signing pad (height / width). */
const PAD_RATIO = 0.32;

function approvalBlock(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  const cellCount = 4;
  const gap = 8;
  const cw = (width - 12 - gap * (cellCount - 1)) / cellCount;
  // The signature square takes the PAD's shape, so the ink fills it edge to edge
  // instead of being letterboxed into a thin strip inside a much wider box.
  const sigH = Math.min(74, Math.max(38, cw * PAD_RATIO));
  const h = 15 + 19 + sigH + 14;
  ensure(ctx, h);
  const y = doc.y;
  const top = box(ctx, left, y, width, h, "Approval");

  const referee = data.approval.officials.find((o) => o.role === "FIRST_REFEREE");
  const sigOf = (role: string) =>
    data.approval.signatures.find((s) => s.role === role) ?? null;

  const cells: {
    caption: string;
    name: string;
    sig: ReturnType<typeof sigOf>;
  }[] = [
    {
      caption: "First referee",
      name: sigOf("FIRST_REFEREE")?.signerName ?? referee?.name ?? "",
      sig: sigOf("FIRST_REFEREE"),
    },
    {
      caption: `Captain — ${trim(data.teamAName)}`,
      name: sigOf("TEAM_A_CAPTAIN")?.signerName ?? captainOf(data.rosterA),
      sig: sigOf("TEAM_A_CAPTAIN"),
    },
    {
      caption: `Captain — ${trim(data.teamBName)}`,
      name: sigOf("TEAM_B_CAPTAIN")?.signerName ?? captainOf(data.rosterB),
      sig: sigOf("TEAM_B_CAPTAIN"),
    },
    {
      caption: "Scorer",
      name: data.approval.officials.find((o) => o.role === "SCORER")?.name ?? "",
      sig: null,
    },
  ];

  cells.forEach((cell, i) => {
    const cx = left + 6 + i * (cw + gap);
    const cy = top;
    // Name strip.
    doc
      .fillColor(DIM)
      .font("Helvetica")
      .fontSize(6.5)
      .text(cell.caption.toUpperCase(), cx, cy, { width: cw, ellipsis: true });
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(cell.name || "—", cx, cy + 7.5, { width: cw, ellipsis: true, lineBreak: false });

    // The signature square — bordered, and the ink is clipped to it.
    const sigBox = { x: cx, y: cy + 19, w: cw, h: sigH };
    doc
      .save()
      .lineWidth(0.7)
      .strokeColor(RULE)
      .rect(sigBox.x, sigBox.y, sigBox.w, sigBox.h)
      .stroke()
      .restore();
    drawSignatureInBox(doc, cell.sig?.strokes ?? null, sigBox);

    const note = cell.sig
      ? cell.sig.intent === "PROTEST"
        ? "signed under protest"
        : cell.sig.intent === "REFUSED"
          ? "refused to sign"
          : `signed ${fmtTime(cell.sig.signedAt)} UTC`
      : "not signed";
    doc
      .fillColor(cell.sig?.intent === "ACCEPT" || !cell.sig ? DIM : INK)
      .font(cell.sig && cell.sig.intent !== "ACCEPT" ? "Helvetica-Bold" : "Helvetica")
      .fontSize(6.5)
      .text(note, cx, sigBox.y + sigBox.h + 2, { width: cw, ellipsis: true, lineBreak: false });
  });
  doc.y = y + h + 4;
}

function captainOf(roster: ReportPlayer[]): string {
  return roster.find((p) => p.isCaptain)?.jerseyName ?? "";
}

// ── footer ──────────────────────────────────────────────────────────────────

function footer(ctx: Ctx, data: MatchReportData) {
  const { doc, left, width } = ctx;
  const sig = data.approval.signatures[0];
  const status =
    data.approval.confirmedVia === "SIGNATURES"
      ? "Result confirmed by signature"
      : data.approval.confirmedVia === "ADMIN"
        ? "Result confirmed by a competition manager (no signatures)"
        : "Result not confirmed";
  doc
    .fillColor(DIM)
    .font("Helvetica")
    .fontSize(6.5)
    .text(
      [
        status,
        data.approval.confirmedAt
          ? `at ${new Date(data.approval.confirmedAt).toISOString().slice(0, 19).replace("T", " ")} UTC`
          : null,
        sig ? `signed at event #${sig.signedSequence}` : null,
        sig ? `result digest ${sig.resultDigest.slice(0, 16)}` : null,
        `match ${data.matchId}`,
      ]
        .filter(Boolean)
        .join("  ·  "),
      left,
      doc.page.height - M - 8,
      { width, ellipsis: true, lineBreak: false },
    );
}
