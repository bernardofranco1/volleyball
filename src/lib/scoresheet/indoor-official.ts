// Official FIVB-style indoor scoresheet (spec/21 Phase C) — a structural
// replica of the VSR sheet, rendered from the event log via
// buildOfficialSheetData. Adaptive: panel count follows config.bestOf, ladder
// lengths follow the configured set targets. Unknown data renders as the
// pre-printed blank cell, exactly like paper.

import PDFDocument from "pdfkit";
import type { TournamentConfig } from "@/engine/config";
import type { MatchReportData } from "@/lib/match-report";
import { drawSignatureInBox } from "@/lib/scoresheet-pdf";
import type { OfficialSheetData, SheetSetData } from "./official-data";
import {
  DIM,
  HEAD,
  INK,
  NAVY,
  PAGE_H,
  PAGE_W,
  Sheet,
  durationHhMm,
  durationMin,
  hhmm,
  registerSheetFonts,
  teamCode,
  vLadder,
} from "./primitives";

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

interface TeamPanelData {
  team: "A" | "B";
  code: string;
  side: "L" | "R" | "";
  serve: "S" | "R" | "";
  set: SheetSetData;
}

export function renderIndoorOfficialPdf(
  report: MatchReportData,
  sheet: OfficialSheetData,
  config: TournamentConfig,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    registerSheetFonts(doc);
    const g = new Sheet(doc);

    if (report.status !== "FINISHED") g.watermark("NOT FINAL — MATCH IN PROGRESS");

    const codeA = teamCode(report.teamACountry, report.teamAName);
    const codeB = teamCode(report.teamBCountry, report.teamBName);
    const ladderMax =
      (config.setScore ?? 25) >= 25 ? 48 : Math.max(20, (config.setScore ?? 25) * 2 - 2);
    const deciderMax = Math.max(16, Math.min(30, (config.setScoreTiebreak ?? 15) * 2));

    header(g, report);

    // ── set panels ──────────────────────────────────────────────────────────
    const bestOf = Math.max(1, config.bestOf ?? 5);
    const regularSets = Math.max(0, bestOf - 1);
    const setData = (n: number): SheetSetData | null =>
      sheet.sets.find((s) => s.setNumber === n) ?? null;

    const panelH = 122;
    const rowY = [68, 194, 320];
    const colX: [number, number][] = [
      [12, 404],
      [424, 406],
    ];
    for (let i = 0; i < regularSets && i < 4; i++) {
      const [x, w] = colX[i % 2];
      const y = rowY[Math.floor(i / 2)];
      setPanel(g, x, y, w, panelH, i + 1, setData(i + 1), {
        codeA,
        codeB,
        ladderMax,
      });
    }
    // Deciding set panel: bottom-left slot (bestOf 5) or the slot after the
    // regular sets (bestOf 3 → row 2 left).
    const deciderIdx = Math.min(regularSets, 4);
    const [dx, dw] = colX[deciderIdx % 2];
    const dy = rowY[Math.floor(deciderIdx / 2)];
    setPanel(g, dx, dy, dw, panelH, bestOf, setData(bestOf), {
      codeA,
      codeB,
      ladderMax: deciderMax,
      decider: true,
    });

    // ── bottom blocks (fixed slots, as on the paper sheet) ──────────────────
    resultsBlock(g, 424, 320, 200, 263, report, sheet, codeA, codeB);
    teamsBlock(g, 632, 320, 198, 263, report, codeA, codeB);
    sanctionsBlock(g, 12, 446, 130, 137, report, sheet);
    remarksAndApproval(g, report, sheet);

    g.footer(
      `Official scoresheet · ${report.competitionName} · match ${report.matchNumber ?? report.matchId} · ` +
        `generated from the event log · times UTC · ${
          report.approval.confirmedVia
            ? `result confirmed via ${report.approval.confirmedVia}`
            : "result not yet confirmed"
        }`,
    );
    doc.end();
  });
}

// ── header ───────────────────────────────────────────────────────────────────

function header(g: Sheet, r: MatchReportData) {
  g.rect(12, 12, 818, 52, { lw: 1 });
  g.rect(740, 12, 90, 52, { lw: 0.8 });
  g.ctext(r.tenantName.slice(0, 16), 785, 28, { size: 10, bold: true });
  g.ctext("OFFICIAL E-SCORESHEET", 785, 42, { size: 4 });
  g.ctext("VOLLEYBALL — INDOOR", 785, 49, { size: 3.6, color: DIM });

  g.text("Competition:", 16, 16, { size: 5 });
  g.text(r.competitionName, 48, 15.4, { size: 6, bold: true, color: INK });
  g.text("Pool/Phase:", 400, 16, { size: 5 });
  g.text([r.phaseName, r.roundName].filter(Boolean).join(" — ") || "", 430, 15.4, {
    size: 6,
    bold: true,
    color: INK,
  });
  g.line(12, 25, 740, 25);

  g.text("City:", 16, 29, { size: 5 });
  g.text(r.city ?? "", 30, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Country:", 130, 29, { size: 5 });
  g.text(r.country ?? "", 152, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Match No.:", 280, 29, { size: 5 });
  g.text(r.matchNumber != null ? String(r.matchNumber) : "", 308, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Date:", 345, 29, { size: 5 });
  g.text(r.scheduledAt ? r.scheduledAt.toISOString().slice(0, 10) : "", 360, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Time:", 430, 29, { size: 5 });
  g.text(hhmm(r.scheduledAt), 446, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Hall:", 490, 29, { size: 5 });
  g.text(r.hall ?? r.venue ?? "", 503, 28.4, { size: 5.6, bold: true, color: INK });
  g.line(12, 38, 740, 38);

  g.text("Division:", 16, 43, { size: 5 });
  const dv: [string, boolean][] = [
    ["Male", r.gender === "MEN"],
    ["Female", r.gender === "WOMEN"],
    ["Mixed", r.gender === "MIXED"],
  ];
  let dx = 40;
  for (const [lab, ck] of dv) {
    g.text(lab, dx, 43, { size: 5 });
    g.checkbox(dx + 19, 41.5, 5.5, ck);
    dx += 48;
  }
  g.text("Category:", 200, 43, { size: 5 });
  const cats: [string, boolean][] = [
    ["Senior", r.category === "SENIOR"],
    ["Junior", r.category === "JUNIOR"],
    ["Youth", r.category === "YOUTH"],
    ["Kid", r.category === "KID"],
  ];
  dx = 228;
  for (const [lab, ck] of cats) {
    g.text(lab, dx, 43, { size: 5 });
    g.checkbox(dx + 18, 41.5, 5.5, ck);
    dx += 46;
  }

  // Teams banner: L/R from the set-1 start side.
  g.circle(430, 55, 6, { lw: 0.8, color: NAVY });
  g.ctext("A", 430, 55, { size: 6, bold: true, color: INK });
  g.text(r.teamAName, 442, 51.6, { size: 8, bold: true, color: INK });
  g.ctext("TEAMS", 570, 52, { size: 5, bold: true });
  g.ctext("vs", 570, 58, { size: 5 });
  g.circle(600, 55, 6, { lw: 0.8, color: NAVY });
  g.ctext("B", 600, 55, { size: 6, bold: true, color: INK });
  g.text(r.teamBName, 612, 51.6, { size: 8, bold: true, color: INK });
}

// ── set panels ───────────────────────────────────────────────────────────────

function setPanel(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  setNumber: number,
  set: SheetSetData | null,
  opts: { codeA: string; codeB: string; ladderMax: number; decider?: boolean },
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, 11, h, HEAD);
  g.rect(x, y, 11, h);
  g.vlabel(`Set ${setNumber}`, x + 5.5, y + h / 2, { size: 7, bold: true });

  // Label rail.
  const lx = x + 11;
  const lw = 34;
  g.rect(lx, y, lw, h);
  const labels: [string, number][] = [
    ["Service order", 13.5],
    ["Nr of starting player", 22],
    ["Substitutes:", 32],
    ["Nr of player", 36.5],
    ["Score at change", 45],
    ["Service round 1·5", 62],
    ["2·6", 74],
    ["3·7", 86],
    ["4·8", 99],
    ["Time-outs", 111],
  ];
  for (const [s, dyy] of labels) g.text(s, lx + 1.2, y + dyy, { size: 3.3, w: lw - 2 });

  const bx = lx + lw + 1;
  const bw = (w - (lw + 12) - 4) / 2;

  // Left panel = the team on the LEFT side at set start (paper convention).
  const leftTeam: "A" | "B" = set?.teamAStartSide === "RIGHT" ? "B" : "A";
  const rightTeam: "A" | "B" = leftTeam === "A" ? "B" : "A";
  const panelFor = (team: "A" | "B", sideLetter: "L" | "R"): TeamPanelData | null =>
    set
      ? {
          team,
          code: team === "A" ? opts.codeA : opts.codeB,
          side: sideLetter,
          serve: set.firstServer ? (set.firstServer === team ? "S" : "R") : "",
          set,
        }
      : null;

  teamBlock(g, bx, y + 1, bw, h - 2, panelFor(leftTeam, "L"), true, opts.ladderMax, set);
  teamBlock(g, bx + bw + 2, y + 1, bw, h - 2, panelFor(rightTeam, "R"), false, opts.ladderMax, set);

  if (opts.decider && set && set.switches.length > 0) {
    const sw = set.switches[0];
    g.text(
      `Change side at ${sw.score.a}:${sw.score.b}`,
      x + w - 120,
      y + h - 8,
      { size: 4.2, bold: true, color: INK },
    );
  }
}

function teamBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  t: TeamPanelData | null,
  showStart: boolean,
  ladderMax: number,
  set: SheetSetData | null,
) {
  const gridW = 120;
  const colW = 20;
  const stripW = w - gridW - 6;
  const hh = 12;

  // Header row.
  g.rect(x, y, 36, hh);
  g.text(showStart ? "START" : "END", x + 1.5, y + 1.2, { size: 3.4 });
  g.text("time", x + 1.5, y + 5, { size: 3.4 });
  g.text(showStart ? hhmm(set?.startedAt ?? null) : hhmm(set?.endedAt ?? null), x + 13, y + 3.6, {
    size: 6,
    bold: true,
    color: INK,
  });
  g.rect(x + 36, y, 24, hh, { fill: HEAD });
  g.ctext("TEAM", x + 48, y + 6, { size: 4.5 });
  g.rect(x + 60, y, 26, hh);
  if (t) g.ctext(t.code, x + 73, y + 6, { size: 6.5, bold: true, color: INK });
  g.rect(x + 86, y, 17, hh);
  g.circle(x + 94.5, y + 6, 4.4, { lw: 0.6, color: NAVY });
  if (t) g.ctext(t.side, x + 94.5, y + 6, { size: 5.5, bold: true, color: INK });
  g.rect(x + 103, y, 17, hh);
  g.circle(x + 111.5, y + 6, 4.4, { lw: 0.6, color: NAVY });
  if (t?.serve) g.ctext(t.serve, x + 111.5, y + 6, { size: 5.5, bold: true, color: INK });
  g.rect(x + gridW, y, stripW + 6, hh, { fill: HEAD });
  g.ctext("POINTS", x + gridW + (stripW + 6) / 2, y + 6, { size: 4.5 });

  const lineup = t ? (t.team === "A" ? t.set.lineupA : t.set.lineupB) : [];
  const service = t ? (t.team === "A" ? t.set.serviceA : t.set.serviceB) : [];
  const subs = t ? (t.team === "A" ? t.set.subsA : t.set.subsB) : [];
  const receivedFirst = !!(t && t.set.firstServer && t.set.firstServer !== t.team);

  // Roman header + starting six.
  let yy = y + hh;
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, yy, colW, 8, { fill: HEAD });
    g.ctext(ROMAN[c], x + c * colW + colW / 2, yy + 4, { size: 4.6, bold: true });
  }
  yy += 8;
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, yy, colW, 12);
    const j = lineup[c];
    if (j != null) g.ctext(j, x + c * colW + colW / 2, yy + 6, { size: 7, bold: true, color: INK });
  }
  yy += 12;

  // Substitutes: player number + two score rows (entry / return).
  const subNo = yy;
  const subS1 = yy + 9;
  const subS2 = yy + 18;
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, subNo, colW, 9);
    g.rect(x + c * colW, subS1, colW, 9);
    g.rect(x + c * colW, subS2, colW, 9);
  }
  for (const s of subs) {
    if (s.col < 0 || s.col > 5) continue;
    const cx = x + s.col * colW + colW / 2;
    if (s.inJersey != null) g.ctext(s.inJersey, cx, subNo + 4.5, { size: 5.8, bold: true, color: INK });
    if (s.returnScore) g.ellipse(cx, subNo + 4.5, 5.4, 3.8, { lw: 0.6 });
    g.ctext(`${s.score.a}:${s.score.b}`, cx, subS1 + 4.5, { size: 4.2, color: INK });
    if (s.returnScore)
      g.ctext(`${s.returnScore.a}:${s.returnScore.b}`, cx, subS2 + 4.5, { size: 4.2, color: INK });
  }
  yy += 27;

  // Service rounds: 4 physical rows carry rounds 1-4 / 5-8.
  const rh = 12.4;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 6; c++) g.rect(x + c * colW, yy + r * rh, colW, rh);
  if (receivedFirst) g.xmark(x, yy, colW, rh);
  for (const e of service) {
    const row = e.round % 4;
    if (e.col < 0 || e.col > 5) continue;
    const cx = x + e.col * colW;
    const cy = yy + row * rh;
    g.ctext(e.score, cx + colW / 2, cy + rh / 2, { size: 5.6, color: INK });
    if (e.circled) g.ellipse(cx + colW / 2, cy + rh / 2, 6.4, 4.6);
  }
  yy += 4 * rh;

  // Time-out boxes ("T" row): the requesting team's score first.
  const tRowH = h - (yy - y);
  g.rect(x, yy, 12, tRowH, { fill: HEAD });
  g.ctext('"T"', x + 6, yy + tRowH / 2, { size: 5, bold: true });
  const tw = (gridW - 12) / 2;
  const myTimeouts = t ? t.set.timeouts.filter((to) => to.team === t.team) : [];
  for (let i = 0; i < 2; i++) {
    g.rect(x + 12 + i * tw, yy, tw, tRowH);
    const to = myTimeouts[i];
    if (to && t) {
      const own = t.team === "A" ? to.score.a : to.score.b;
      const opp = t.team === "A" ? to.score.b : to.score.a;
      g.ctext(`${own}:${opp}`, x + 12 + i * tw + tw / 2, yy + tRowH / 2, { size: 5.4, color: INK });
    }
  }

  // Points strip.
  const points = t ? (t.team === "A" ? t.set.scoreA : t.set.scoreB) : 0;
  vLadder(g, x + gridW, y + hh, stripW + 6, h - hh, ladderMax, points);
}

// ── results ──────────────────────────────────────────────────────────────────

function resultsBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  sheet: OfficialSheetData,
  codeA: string,
  codeB: string,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD);
  g.ctext("RESULTS", x + w / 2, y + 5.5, { size: 6.5, bold: true });
  let yy = y + 11;
  g.rect(x, yy, w, 10);
  g.ctext(`TEAM  ${codeA}  (A)`, x + w * 0.25, yy + 5, { size: 5, bold: true, color: INK });
  g.ctext(`(B)  ${codeB}  TEAM`, x + w * 0.75, yy + 5, { size: 5, bold: true, color: INK });
  yy += 10;

  const cols = ["T", "S", "W", "P", "SET (Dur)", "P", "W", "S", "T"];
  const rel = [13, 13, 13, 16, 56, 16, 13, 13, 13];
  const totalRel = rel.reduce((a, b) => a + b, 0);
  const cws = rel.map((r) => (r / totalRel) * w);
  const colX: number[] = [];
  let cx = x;
  for (const cwidth of cws) {
    colX.push(cx);
    cx += cwidth;
  }
  cols.forEach((c, i) => {
    g.rect(colX[i], yy, cws[i], 9, { fill: HEAD });
    g.ctext(c, colX[i] + cws[i] / 2, yy + 4.5, { size: 4.2, bold: true });
  });
  yy += 9;

  const bestOf = Math.max(sheet.sets.length, report.sets.length, 3);
  const rowH = 11;
  const totals = { ta: 0, sa: 0, wa: 0, pa: 0, pb: 0, wb: 0, sb: 0, tb: 0, dur: 0 };
  for (let n = 1; n <= Math.min(bestOf, 5); n++) {
    const s = sheet.sets.find((ss) => ss.setNumber === n) ?? null;
    const dur = s ? durationMin(s.startedAt, s.endedAt) : null;
    const vals = s
      ? [
          s.timeouts.filter((t) => t.team === "A").length,
          s.subsA.length,
          s.winner === "A" ? 1 : 0,
          s.scoreA,
          `${n}   ( ${dur ?? " "} )`,
          s.scoreB,
          s.winner === "B" ? 1 : 0,
          s.subsB.length,
          s.timeouts.filter((t) => t.team === "B").length,
        ]
      : ["", "", "", "", `${n}   (    )`, "", "", "", ""];
    if (s) {
      totals.ta += vals[0] as number;
      totals.sa += vals[1] as number;
      totals.wa += vals[2] as number;
      totals.pa += vals[3] as number;
      totals.pb += vals[5] as number;
      totals.wb += vals[6] as number;
      totals.sb += vals[7] as number;
      totals.tb += vals[8] as number;
      totals.dur += dur ?? 0;
    }
    vals.forEach((v, i) => {
      g.rect(colX[i], yy, cws[i], rowH);
      g.ctext(v, colX[i] + cws[i] / 2, yy + rowH / 2, { size: 5.2, color: i === 4 ? NAVY : INK });
    });
    yy += rowH;
  }
  const tvals = [
    totals.ta,
    totals.sa,
    totals.wa,
    totals.pa,
    `Total ( ${totals.dur} m)`,
    totals.pb,
    totals.wb,
    totals.sb,
    totals.tb,
  ];
  tvals.forEach((v, i) => {
    g.rect(colX[i], yy, cws[i], rowH, { fill: HEAD });
    g.ctext(v, colX[i] + cws[i] / 2, yy + rowH / 2, { size: 5.2, bold: true, color: i === 4 ? NAVY : INK });
  });
  yy += rowH + 3;

  const thW = (w - 8) / 3;
  const times: [string, string][] = [
    ["Match starting time", hhmm(report.startedAt)],
    ["Match ending time", hhmm(report.finishedAt)],
    ["Match total time", durationHhMm(report.startedAt, report.finishedAt)],
  ];
  times.forEach(([lab, val], i) => {
    g.rect(x + 4 + i * thW, yy, thW - 2, 18);
    g.ctext(lab, x + 4 + i * thW + (thW - 2) / 2, yy + 4.5, { size: 3.8 });
    g.ctext(val, x + 4 + i * thW + (thW - 2) / 2, yy + 12, { size: 6.5, bold: true, color: INK });
  });
  yy += 22;

  g.rect(x + 4, yy, w - 8, 16);
  g.text("WINNER", x + 8, yy + 5.5, { size: 5.5, bold: true });
  const winnerName =
    report.winner === "A" ? report.teamAName : report.winner === "B" ? report.teamBName : "";
  g.ctext(winnerName, x + w / 2, yy + 8, { size: 7.5, bold: true, color: INK });
  if (report.winner) {
    // Winner-first, as on the paper sheet ("WINNER Türkiye 3:1").
    const first = report.winner === "B" ? report.setsWonB : report.setsWonA;
    const second = report.winner === "B" ? report.setsWonA : report.setsWonB;
    g.ctext(`${first}:${second}`, x + w - 22, yy + 8, { size: 8, bold: true, color: INK });
  }

  if (sheet.forfeit) {
    g.text(
      `${sheet.forfeit.reason === "RETIREMENT" ? "Retirement" : "Forfeit"}: team ${sheet.forfeit.team}`,
      x + 6,
      yy + 20,
      { size: 4.6, bold: true, color: INK },
    );
  }
}

// ── teams / rosters ──────────────────────────────────────────────────────────

function teamsBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  codeA: string,
  codeB: string,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD);
  g.ctext(`(A) ${codeA}    TEAMS    ${codeB} (B)`, x + w / 2, y + 5.5, { size: 6, bold: true });
  let yy = y + 11;
  const half = w / 2;

  const fieldPlayers = (roster: MatchReportData["rosterA"]) => roster.filter((p) => !p.isLibero);
  const liberos = (roster: MatchReportData["rosterA"]) => roster.filter((p) => p.isLibero);
  const listA = fieldPlayers(report.rosterA);
  const listB = fieldPlayers(report.rosterB);
  const libA = liberos(report.rosterA);
  const libB = liberos(report.rosterB);

  g.rect(x, yy, half, 8, { fill: HEAD });
  g.text("No.  Name of player", x + 3, yy + 2.4, { size: 4 });
  g.rect(x + half, yy, half, 8, { fill: HEAD });
  g.text("No.  Name of player", x + half + 3, yy + 2.4, { size: 4 });
  yy += 8;

  const liberoRows = Math.max(libA.length, libB.length, 1);
  const sigH = 26;
  const rosterRows = Math.max(listA.length, listB.length, 6);
  const rh = Math.min(
    9,
    Math.max(6.4, (h - 11 - 8 - 8 - 8 - sigH - liberoRows * 8) / rosterRows),
  );
  for (let i = 0; i < rosterRows; i++) {
    for (const [side, roster] of [
      [0, listA],
      [1, listB],
    ] as const) {
      const rx = x + side * half;
      g.rect(rx, yy, 13, rh);
      g.rect(rx + 13, yy, half - 13, rh);
      const p = roster[i];
      if (p) {
        if (p.jerseyNumber != null)
          g.ctext(p.jerseyNumber, rx + 6.5, yy + rh / 2, { size: 5, bold: true, color: INK });
        if (p.isCaptain) g.ellipse(rx + 6.5, yy + rh / 2, 5, Math.min(3.6, rh * 0.44), { lw: 0.6 });
        g.text(p.fullName.slice(0, 30), rx + 15, yy + rh / 2 - 2.2, { size: 4.4, color: INK });
      }
    }
    yy += rh;
  }

  g.rect(x, yy, w, 8, { fill: HEAD });
  g.ctext('LIBERO PLAYERS ("L")', x + w / 2, yy + 4, { size: 4.4, bold: true });
  yy += 8;
  for (let i = 0; i < liberoRows; i++) {
    for (const [side, libs] of [
      [0, libA],
      [1, libB],
    ] as const) {
      const rx = x + side * half;
      g.rect(rx, yy, 13, 8);
      g.rect(rx + 13, yy, half - 13, 8);
      const p = libs[i];
      if (p) {
        if (p.jerseyNumber != null)
          g.ctext(p.jerseyNumber, rx + 6.5, yy + 4, { size: 5, bold: true, color: INK });
        g.text(p.fullName.slice(0, 30), rx + 15, yy + 1.8, { size: 4.4, color: INK });
      }
    }
    yy += 8;
  }

  // Captains sign here pre-match on the paper sheet — capture is spec/21
  // Phase D; until then the boxes render blank, exactly like unsigned paper.
  g.rect(x, yy, w, 8, { fill: HEAD });
  g.ctext("SIGNATURES (pre-match)", x + w / 2, yy + 4, { size: 4.4, bold: true });
  yy += 8;
  const sh = y + h - yy;
  for (const [i, label] of (["Team captain", "Coach"] as const).entries()) {
    for (const side of [0, 1] as const) {
      const rx = x + side * half;
      const cy = yy + i * (sh / 2);
      g.rect(rx, cy, half, sh / 2);
      g.text(label, rx + 2, cy + 1.6, { size: 3.6 });
    }
  }
}

// ── sanctions + improper request ─────────────────────────────────────────────

const SANCTION_COL: Record<string, number> = {
  DELAY_WARNING: 0,
  MISCONDUCT_WARNING: 0,
  DELAY_PENALTY: 1,
  MISCONDUCT_PENALTY: 1,
  MISCONDUCT_EXPULSION: 2,
  MISCONDUCT_DISQUALIFICATION: 3,
};

function sanctionsBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  sheet: OfficialSheetData,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD);
  g.ctext("SANCTIONS", x + w / 2, y + 5.5, { size: 6, bold: true });
  let yy = y + 11;
  const heads = ["W", "P", "E", "D", "A/B", "SET", "SCORE"];
  const sub = ["(Warn)", "(Pena)", "(Expu)", "(Disq)", "", "", ""];
  const cw = w / 7;
  heads.forEach((hd, i) => {
    g.rect(x + i * cw, yy, cw, 10, { fill: HEAD });
    g.ctext(hd, x + i * cw + cw / 2, yy + 3, { size: 3.8, bold: true });
    if (sub[i]) g.ctext(sub[i], x + i * cw + cw / 2, yy + 7, { size: 2.8 });
  });
  yy += 10;
  const rows = 6;
  const rh = (h - 11 - 10 - 24) / rows;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 7; i++) g.rect(x + i * cw, yy + r * rh, cw, rh);
    const s = sheet.sanctions[r];
    if (s) {
      const col = SANCTION_COL[s.kind] ?? 0;
      const mark = s.jersey != null ? String(s.jersey) : s.kind.startsWith("DELAY") ? "D" : "•";
      g.ctext(mark, x + col * cw + cw / 2, yy + r * rh + rh / 2, { size: 4.8, bold: true, color: INK });
      g.ctext(s.team, x + 4 * cw + cw / 2, yy + r * rh + rh / 2, { size: 4.8, color: INK });
      g.ctext(s.setNumber, x + 5 * cw + cw / 2, yy + r * rh + rh / 2, { size: 4.8, color: INK });
      g.ctext(`${s.score.a}:${s.score.b}`, x + 6 * cw + cw / 2, yy + r * rh + rh / 2, { size: 4.2, color: INK });
    }
  }
  yy += rows * rh;

  g.rect(x, yy, w, 24);
  g.text("IMPROPER REQUEST", x + 3, yy + 3, { size: 4.6, bold: true });
  g.text("TEAM", x + 8, yy + 13, { size: 4.6 });
  const irA = sheet.improperRequests.some((r) => r.team === "A");
  const irB = sheet.improperRequests.some((r) => r.team === "B");
  g.circle(x + 30, yy + 15, 4.5, { lw: 0.6, color: NAVY });
  g.ctext("A", x + 30, yy + 15, { size: 4.6 });
  if (irA) g.xmark(x + 25.5, yy + 10.5, 9, 9, { lw: 0.8 });
  g.ctext(":", x + 42, yy + 15, { size: 5 });
  g.circle(x + 54, yy + 15, 4.5, { lw: 0.6, color: NAVY });
  g.ctext("B", x + 54, yy + 15, { size: 4.6 });
  if (irB) g.xmark(x + 49.5, yy + 10.5, 9, 9, { lw: 0.8 });
  g.text("TEAM", x + 62, yy + 13, { size: 4.6 });
}

// ── remarks + approval ───────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  FIRST_REFEREE: "First referee",
  SECOND_REFEREE: "Second referee",
  SCORER: "Scorer",
  THIRD_REFEREE: "Third referee",
  ASSISTANT_SCORER: "Assistant scorer",
  CHALLENGE_REFEREE: "Challenge referee",
};

function remarksAndApproval(g: Sheet, report: MatchReportData, sheet: OfficialSheetData) {
  // Remarks.
  g.rect(146, 446, 274, 30, { lw: 0.9 });
  g.fillRect(146, 446, 274, 9, HEAD);
  g.ctext("REMARKS", 283, 450.5, { size: 5, bold: true });
  const sigRemarks = report.approval.signatures
    .filter((s) => s.remarks)
    .map((s) => `${s.role}: ${s.remarks}`);
  const remarks = [...sheet.remarks, ...sigRemarks].join(" · ").slice(0, 220);
  g.text(remarks, 150, 458, { size: 4.8, color: INK, w: 266 });

  // Approval.
  const x = 146;
  const y = 479;
  const w = 274;
  const h = 104;
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 10, HEAD);
  g.ctext("APPROVAL", x + w / 2, y + 5, { size: 6, bold: true });
  let yy = y + 10;
  const cw = [56, 92, 28, w - 56 - 92 - 28];
  const colX = [x, x + 56, x + 148, x + 176];
  const heads = ["Referee", "Name", "Level", "Signature"];
  heads.forEach((hd, i) => {
    g.rect(colX[i], yy, cw[i], 8, { fill: HEAD });
    g.ctext(hd, colX[i] + cw[i] / 2, yy + 4, { size: 4, bold: true });
  });
  yy += 8;
  const officials = new Map(report.approval.officials.map((o) => [o.role, o]));
  const sigByRole = new Map(report.approval.signatures.map((s) => [s.role, s]));
  const rh = 9.4;
  for (const [role, label] of Object.entries(ROLE_LABEL)) {
    const o = officials.get(role);
    g.rect(colX[0], yy, cw[0], rh);
    g.text(label, colX[0] + 2, yy + 2.8, { size: 4 });
    g.rect(colX[1], yy, cw[1], rh);
    if (o) g.text(o.name.slice(0, 32), colX[1] + 2, yy + 2.6, { size: 4.4, color: INK });
    g.rect(colX[2], yy, cw[2], rh);
    if (o?.level || o?.country)
      g.ctext(o.level ?? o.country ?? "", colX[2] + cw[2] / 2, yy + rh / 2, { size: 4.2, color: INK });
    g.rect(colX[3], yy, cw[3], rh);
    if (role === "FIRST_REFEREE") {
      const sig = sigByRole.get("FIRST_REFEREE");
      if (sig?.strokes)
        drawSignatureInBox(g.d, sig.strokes, { x: colX[3] + 2, y: yy + 0.5, w: cw[3] - 4, h: rh - 1 });
    }
    yy += rh;
  }
  // Line judges.
  g.rect(x, yy, 56, 11);
  g.text("Line judges", x + 2, yy + 3.6, { size: 4.2 });
  const ljw = (w - 56) / 4;
  for (let i = 0; i < 4; i++) {
    g.rect(x + 56 + i * ljw, yy, ljw, 11);
    const o = officials.get(`LINE_JUDGE_${i + 1}`);
    g.text(`${i + 1} ${o ? o.name.slice(0, 14) : ""}`, x + 58 + i * ljw, yy + 3, { size: 3.8, color: o ? INK : NAVY });
  }
  yy += 11;
  // Team captains (post-match signatures, spec/20).
  const capH = y + h - yy;
  g.rect(x, yy, 56, capH);
  g.text("Team captains", x + 2, yy + 3.6, { size: 4.2 });
  const tcw = (w - 56) / 2;
  (["TEAM_A_CAPTAIN", "TEAM_B_CAPTAIN"] as const).forEach((role, i) => {
    const bx = x + 56 + i * tcw;
    g.rect(bx, yy, tcw, capH);
    g.text(i === 0 ? "A" : "B", bx + 2, yy + 1.6, { size: 4, bold: true });
    const sig = sigByRole.get(role);
    if (sig?.strokes)
      drawSignatureInBox(g.d, sig.strokes, { x: bx + 10, y: yy + 1, w: tcw - 14, h: capH - 2 });
    if (sig && !sig.strokes)
      g.text(sig.intent === "REFUSED" ? "refused to sign" : sig.signerName, bx + 10, yy + capH / 2 - 2, {
        size: 4,
        color: INK,
      });
  });
}
