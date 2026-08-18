// Match-report + event-log PDF renderers (spec/10 §"PDF export", spec/17
// event-log record). Extracted from the export.pdf route so tests (and any
// future callers) can import the renderers without dragging in the route's
// graph (next/server, authz, supabase, db, match-engine). PDFKit needs Node
// APIs + reads its AFM font metrics from disk — Node-runtime only.
import PDFDocument from "pdfkit";
import {
  type MatchReportData,
  type ReportEvent,
  isInterruption,
} from "@/lib/match-report";
import { drawSignatureInBox } from "@/lib/scoresheet-pdf";
import { forfeitReasonLabel } from "@/lib/domain";


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

/** Exported for the render tests (no DB, fabricated data). */
export function renderPdf(data: MatchReportData): Promise<Buffer> {
  // Audit tables below print as-recorded scores and mark rows a later
  // correction removed (spec/30 Phase D).
  const suffix = cancelSuffixFor(data.events);
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
          // As-recorded values, marked when later cancelled (spec/30 Phase D):
          // this is an audit table, so the row stays and states both facts —
          // and names WHICH correction removed it, so an auditor need not
          // chase ids.
          e.eventType + suffix(e),
          new Date(e.timestamp).toUTCString().slice(17, 25),
        ]);
      }
    }

    // ── Approval (scoresheet signatures) ────────────────────────────────────
    renderApproval(doc, data, left, width, heading);

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
          e.eventType + suffix(e),
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

// ── Approval block (spec/20) ────────────────────────────────────────────────
// The paper sheet's APPROVAL / SIGNATURES box: who signed, as what, when, and
// the mark itself. Signatures are stored as vector polylines normalised to the
// pad box, so they are drawn here with plain PDF path operators — no raster
// image, and crisp at any print size.

const SIG_BOX = { w: 150, h: 48 };

function drawSignature(
  doc: PDFKit.PDFDocument,
  strokes: { pad: { w: number; h: number }; strokes: number[][][] } | null,
  x: number,
  y: number,
  w = SIG_BOX.w,
  h = SIG_BOX.h,
) {
  // Signature line, always drawn — an empty box is itself a statement.
  doc.save().lineWidth(0.5).strokeColor(RULE);
  doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
  doc.restore();
  // Ink is placed and clipped by the scoresheet helper: one implementation of
  // the unit-square → page-box contract for both documents.
  drawSignatureInBox(doc, strokes, { x, y, w, h });
}

function intentNote(intent: string): string {
  if (intent === "PROTEST") return " (signed under protest)";
  if (intent === "REFUSED") return " (refused to sign)";
  return "";
}

function renderApproval(
  doc: PDFKit.PDFDocument,
  data: MatchReportData,
  left: number,
  width: number,
  heading: (text: string) => void,
) {
  const { approval } = data;
  heading("Approval");

  const status =
    approval.confirmedVia === "SIGNATURES"
      ? `Result confirmed by signature — ${fmtDateTime(approval.confirmedAt)}`
      : approval.confirmedVia === "ADMIN"
        ? `Result confirmed by a competition manager — ${fmtDateTime(approval.confirmedAt)}`
        : "Result not confirmed yet.";
  doc.fillColor(DIM).font("Helvetica").fontSize(9).text(status, left, doc.y);
  doc.moveDown(0.5);

  const referee = approval.officials.find((o) => o.role === "FIRST_REFEREE");
  const sigOf = (role: string) => approval.signatures.find((s) => s.role === role);

  // Three boxes side by side where the page allows: A captain, B captain, 1st ref.
  const entries = [
    {
      label: `${data.teamAName} — captain`,
      sig: sigOf("TEAM_A_CAPTAIN"),
      fallbackName: null as string | null,
    },
    {
      label: `${data.teamBName} — captain`,
      sig: sigOf("TEAM_B_CAPTAIN"),
      fallbackName: null as string | null,
    },
    {
      label: "First referee",
      sig: sigOf("FIRST_REFEREE"),
      fallbackName: referee?.name ?? null,
    },
  ];

  const boxW = Math.min(SIG_BOX.w, (width - 24) / 3);
  const boxH = SIG_BOX.h;
  ensureSpace(doc, boxH + 46);
  const top = doc.y;
  entries.forEach((entry, i) => {
    const x = left + i * (boxW + 12);
    doc
      .fillColor(DIM)
      .font("Helvetica")
      .fontSize(8)
      .text(entry.label.toUpperCase(), x, top, { width: boxW, ellipsis: true });
    drawSignature(doc, entry.sig?.strokes ?? null, x, top + 12, boxW, boxH);
    const name = entry.sig?.signerName ?? entry.fallbackName ?? "—";
    doc
      .fillColor(INK)
      .font("Helvetica")
      .fontSize(8)
      .text(`${name}${entry.sig ? intentNote(entry.sig.intent) : ""}`, x, top + boxH + 16, {
        width: boxW,
        ellipsis: true,
      });
    if (entry.sig)
      doc
        .fillColor(DIM)
        .fontSize(7)
        .text(fmtDateTime(entry.sig.signedAt), x, top + boxH + 26, {
          width: boxW,
          ellipsis: true,
        });
  });
  doc.y = top + boxH + 40;

  // Remarks that came with a protest or a refusal belong on the sheet.
  const remarks = approval.signatures.filter((s) => s.remarks);
  if (remarks.length > 0) {
    doc.moveDown(0.4);
    doc.fillColor(DIM).font("Helvetica-Bold").fontSize(8).text("REMARKS", left, doc.y);
    for (const s of remarks) {
      ensureSpace(doc, 14);
      doc
        .fillColor(INK)
        .font("Helvetica")
        .fontSize(8)
        .text(`${s.signerName}${intentNote(s.intent)}: ${s.remarks}`, left, doc.y, {
          width,
        });
    }
  }

  // Verification trail: the digest ties this printed sheet to one exact state of
  // the event log, so a reprint can be checked against the data.
  const first = approval.signatures[0];
  if (first) {
    doc.moveDown(0.4);
    doc
      .fillColor(DIM)
      .font("Helvetica")
      .fontSize(7)
      .text(
        `Signed at event #${first.signedSequence} · result digest ${first.resultDigest.slice(0, 16)}`,
        left,
        doc.y,
        { width },
      );
  }
}

// ── Event-log document (?type=log) ──────────────────────────────────────────
// One readable line per event, in match order, with the payload's who/why
// (team, reason, decision) spelled out — the record a referee reaches for in a
// protest. English-only like the report; player ids are not resolved here.

const NOISE_EVENTS = new Set(["MATCH_CREATED"]);

/**
 * Replicate the engine's survivor pass over the raw log to work out which
 * rows were struck by a correction: UNDO removes its target, REWIND removes
 * every survivor after its cutoff. Returns event id → the correction that
 * removed it (e.g. "undo #14"), so the printed log can annotate both sides —
 * the auditor sees what happened AND what corrected it without chasing ids.
 */
export function removedByCorrections(events: ReportEvent[]): Map<string, string> {
  const removedBy = new Map<string, string>();
  const survivors: ReportEvent[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.eventType === "UNDO") {
      const i = survivors.findIndex((s) => s.id === p.targetEventId);
      if (i !== -1) {
        removedBy.set(survivors[i].id, `undo #${e.sequence}`);
        survivors.splice(i, 1);
      }
      continue;
    }
    if (e.eventType === "REWIND") {
      const cutoff = typeof p.toSequence === "number" ? p.toSequence : Infinity;
      for (let i = survivors.length - 1; i >= 0; i--) {
        if (survivors[i].sequence > cutoff) {
          removedBy.set(survivors[i].id, `rewind #${e.sequence}`);
          survivors.splice(i, 1);
        }
      }
      continue;
    }
    survivors.push(e);
  }
  return removedBy;
}

/**
 * "" or " ✕ cancelled (undo #14)" — the audit-view marking (spec/30 Phase D).
 *
 * Built from `removedByCorrections`, which already resolves UNDO/REWIND and
 * names the correction responsible. Recomputed per block rather than threaded
 * through: these renderers are called once per document and the log is small.
 */
function cancelSuffixFor(events: ReportEvent[]): (e: ReportEvent) => string {
  const removedBy = removedByCorrections(events);
  return (e) => {
    const by = removedBy.get(e.id);
    return by ? ` ✕ cancelled (${by})` : "";
  };
}

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
      return `${forfeitReasonLabel(String(p.reason))} — ${team(p.team)}`;
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
    case "REWIND": {
      const c = typeof p.toSequence === "number" ? ` after #${p.toSequence}` : "";
      // The reason (e.notes) prints on its own indented line in renderLogPdf —
      // inlined here it wraps the fixed-height table row into its neighbour.
      return `Admin rewind (events${c} erased)`;
    }
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
    // Corrections are printed on both sides: struck rows carry which UNDO/
    // REWIND removed them, and each UNDO names the sequence it removed.
    const removedBy = removedByCorrections(data.events);
    const seqById = new Map(data.events.map((e) => [e.id, e.sequence]));
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
      let desc = describeLogEvent(e, data.teamAName, data.teamBName);
      if (e.eventType === "UNDO") {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const targetSeq =
          typeof p.targetEventId === "string" ? seqById.get(p.targetEventId) : undefined;
        if (targetSeq != null) desc = `Undo — removed #${targetSeq}`;
      }
      const struck = removedBy.get(e.id);
      if (struck) desc = `${desc}  · struck by ${struck}`;
      tableRow(
        doc,
        left,
        width,
        cols,
        [
          String(e.sequence),
          e.setNumber != null ? String(e.setNumber) : "—",
          e.scoreAfterA != null && e.scoreAfterB != null
            ? `${e.scoreAfterA}–${e.scoreAfterB}`
            : "—",
          desc,
          e.actor,
          new Date(e.timestamp).toUTCString().slice(17, 25),
        ],
        // Struck rows print greyed so the corrected narrative reads at a
        // glance, while the removed entries stay fully legible on the record.
        { color: struck ? DIM : INK },
      );
      // A rewind's recorded justification gets its own wrapped line — audit
      // remarks must print in full, never ellipsized into the table cell.
      if (e.eventType === "REWIND" && e.notes) {
        ensureSpace(doc, 14);
        doc
          .fillColor(DIM)
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text(`reason: ${e.notes}`, left + width * 0.25, doc.y, {
            width: width * 0.72,
          });
        doc.moveDown(0.2);
      }
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
  opts: { color?: string } = {},
) {
  doc.font("Helvetica").fontSize(9).fillColor(opts.color ?? INK);
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
