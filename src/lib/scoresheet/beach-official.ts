// Official FIVB-style beach scoresheet (spec/21 Phase C) — two A4 landscape
// pages replicating the Beach Volleyball International Scoresheet: sets 1-2 on
// page 1, the deciding set + TEAMS / RESULTS / APPROVAL / REMARKS / coin-toss
// blocks on page 2. Rendered from the event log via buildOfficialSheetData.

import PDFDocument from "pdfkit";
import type { TournamentConfig } from "@/engine/config";
import type { MatchReportData } from "@/lib/match-report";
import { drawSignatureInBox } from "@/lib/scoresheet-pdf";
import type { OfficialSheetData, SheetSetData, SheetSanction } from "./official-data";
import {
  DIM,
  HEAD,
  INK,
  NAVY,
  PAGE_H,
  PAGE_W,
  Sheet,
  durationMin,
  hhmmss,
  registerSheetFonts,
  teamCode,
  hLadder,
} from "./primitives";

type TeamId = "A" | "B";

export function renderBeachOfficialPdf(
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

    const bestOf = Math.max(1, config.bestOf ?? 3);
    const ladderMax =
      (config.setScore ?? 21) === 21 ? 44 : Math.max(20, Math.min(48, (config.setScore ?? 21) * 2 + 2));
    const setData = (n: number): SheetSetData | null =>
      sheet.sets.find((s) => s.setNumber === n) ?? null;

    // Page 1: header + sets 1-2.
    if (report.status !== "FINISHED") g.watermark("NOT FINAL — MATCH IN PROGRESS");
    let y = headerBlock(g, report, bestOf, false);
    y = teamsBanner(g, report, y);
    setPanel(g, 12, y + 2, 818, 226, 1, setData(1), report, sheet, ladderMax);
    if (bestOf >= 2)
      setPanel(g, 12, y + 236, 818, 226, 2, setData(2), report, sheet, ladderMax);
    g.footer(footerText(report, "1/2"));

    // Page 2: deciding set + bottom blocks.
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    if (report.status !== "FINISHED") g.watermark("NOT FINAL — MATCH IN PROGRESS");
    const y2 = headerBlock(g, report, bestOf, true);
    if (bestOf >= 3) {
      const deciderMax = Math.max(
        16,
        Math.min(44, (config.setScoreTiebreak ?? 15) * 2 + 2),
      );
      setPanel(g, 12, y2, 818, 226, bestOf, setData(bestOf), report, sheet, deciderMax);
    }
    const by = y2 + 232;
    const bottomH = PAGE_H - by - 14;
    teamsBlock(g, 12, by, 462, 92, report, sheet);
    resultsBlock(g, 12, by + 95, 462, 86, report, sheet);
    approvalBlock(g, 12, by + 184, 462, bottomH - 184, report);
    remarksAndToss(g, 480, by, 350, bottomH, report, sheet);
    g.footer(footerText(report, "2/2"));

    doc.end();
  });
}

function footerText(report: MatchReportData, page: string): string {
  return (
    `Official scoresheet · ${report.competitionName} · match ${report.matchNumber ?? report.matchId} · ` +
    `generated from the event log · times UTC · ${
      report.approval.confirmedVia
        ? `result confirmed via ${report.approval.confirmedVia}`
        : "result not yet confirmed"
    } · page ${page}`
  );
}

// ── header + teams banner ────────────────────────────────────────────────────

function headerBlock(g: Sheet, r: MatchReportData, bestOf: number, small: boolean): number {
  g.text("BEACH VOLLEYBALL INTERNATIONAL E-SCORESHEET", 14, 14, {
    size: small ? 10 : 14,
    bold: true,
  });
  g.text(`RPS — ${Math.ceil(bestOf / 2)} out of ${bestOf} sets`, small ? 300 : 400, small ? 17 : 19, {
    size: 6,
    bold: true,
  });
  g.rect(PAGE_W - 130, 12, 116, 16);
  g.ctext(r.tenantName.toUpperCase().slice(0, 22), PAGE_W - 72, 20, { size: 5.5, bold: true });

  g.text("Competition:", 14, small ? 28 : 34, { size: 5.5 });
  g.text(r.competitionName, 46, (small ? 28 : 34) - 0.6, { size: 6, bold: true, color: INK });
  const y2 = small ? 37 : 44;
  const items: [string, string, number][] = [
    ["Match No.:", r.matchNumber != null ? String(r.matchNumber) : "", 14],
    ["Site:", (r.city ?? "").slice(0, 18), 90],
    ["Beach:", (r.hall ?? r.venue ?? "").slice(0, 24), 190],
    ["Court:", r.courtNumber != null ? String(r.courtNumber) : "", 310],
    ["Date:", r.scheduledAt ? r.scheduledAt.toISOString().slice(0, 10) : "", 365],
    ["Gender:", r.gender === "MEN" ? "M" : r.gender === "WOMEN" ? "F" : r.gender === "MIXED" ? "X" : "", 450],
    ["Phase:", (r.phaseName ?? "").slice(0, 18), 510],
    ["Round:", (r.roundName ?? "").slice(0, 24), 620],
  ];
  for (const [lab, val, ix] of items) {
    g.text(lab, ix, y2, { size: 5.5 });
    g.text(val, ix + lab.length * 2.4 + 4, y2 - 0.4, { size: 6, bold: true, color: INK });
  }
  return y2 + 10;
}

function teamsBanner(g: Sheet, r: MatchReportData, y: number): number {
  g.text("A or B", 16, y + 1, { size: 3.4 });
  g.circle(24, y + 12, 6.5, { lw: 0.9, color: NAVY });
  g.ctext("A", 24, y + 12, { size: 7, bold: true, color: INK });
  g.ctext(r.teamAName, 200, y + 12, { size: 9, bold: true, color: INK });
  g.text("Country", 366, y + 4, { size: 4.4 });
  g.ctext(teamCode(r.teamACountry, r.teamAName), 376, y + 14, { size: 7, bold: true, color: INK });
  g.ctext("TEAMS", 420, y + 8, { size: 6, bold: true });
  g.ctext("vs", 420, y + 16, { size: 6 });
  g.text("A or B", 446, y + 1, { size: 3.4 });
  g.circle(454, y + 12, 6.5, { lw: 0.9, color: NAVY });
  g.ctext("B", 454, y + 12, { size: 7, bold: true, color: INK });
  g.ctext(r.teamBName, 630, y + 12, { size: 9, bold: true, color: INK });
  g.text("Country", 790, y + 4, { size: 4.4 });
  g.ctext(teamCode(r.teamBCountry, r.teamBName), 800, y + 14, { size: 7, bold: true, color: INK });
  return y + 26;
}

// ── set panel ────────────────────────────────────────────────────────────────

interface HalfData {
  team: TeamId;
  code: string;
  orders: [string, number | null][]; // [roman label, jersey]
  rows: { score: number; circled: boolean }[][]; // per player slot
  points: number;
  timeout: { own: number; opp: number } | null;
  sanctions: SheetSanction[];
}

function halfData(
  team: TeamId,
  serving: boolean,
  set: SheetSetData,
  report: MatchReportData,
  sheet: OfficialSheetData,
): HalfData {
  const order = team === "A" ? set.serviceOrderA : set.serviceOrderB;
  const service = team === "A" ? set.serviceA : set.serviceB;
  const labels: [string, string] = serving ? ["I", "III"] : ["II", "IV"];
  const rows: { score: number; circled: boolean }[][] = [[], []];
  for (const e of service) {
    if (e.col === 0 || e.col === 1) rows[e.col].push({ score: e.score, circled: e.circled });
  }
  const to = set.timeouts.find((t) => t.team === team) ?? null;
  return {
    team,
    code: teamCode(
      team === "A" ? report.teamACountry : report.teamBCountry,
      team === "A" ? report.teamAName : report.teamBName,
    ),
    orders: [
      [labels[0], order[0] ?? null],
      [labels[1], order[1] ?? null],
    ],
    rows,
    points: team === "A" ? set.scoreA : set.scoreB,
    timeout: to
      ? team === "A"
        ? { own: to.score.a, opp: to.score.b }
        : { own: to.score.b, opp: to.score.a }
      : null,
    sanctions: sheet.sanctions.filter((s) => s.team === team && s.setNumber === set.setNumber),
  };
}

function setPanel(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  setNumber: number,
  set: SheetSetData | null,
  report: MatchReportData,
  sheet: OfficialSheetData,
  ladderMax: number,
) {
  g.rect(x, y, w, h, { lw: 1 });
  const railW = 56;
  const leftW = 158;
  const cx0 = x + leftW + 6;
  const cw = w - leftW - railW - 16;

  // Title row.
  g.rect(cx0 + cw / 2 - 30, y + 4, 60, 14);
  g.ctext(`Set ${setNumber}`, cx0 + cw / 2, y + 11, { size: 7.5, bold: true });
  if (set?.startedAt)
    g.text(`Start time: ${hhmmss(set.startedAt)}`, cx0 + cw - 110, y + 7, { size: 6.5, bold: true, color: INK });

  const topTeam: TeamId = set?.firstServer ?? "A";
  const botTeam: TeamId = topTeam === "A" ? "B" : "A";
  const top = set ? halfData(topTeam, true, set, report, sheet) : null;
  const bot = set ? halfData(botTeam, false, set, report, sheet) : null;

  teamLeftBlock(g, x + 3, y + 4, leftW, top, false);
  serviceRow(g, cx0, y + 24, cw, 19, top?.rows[0] ?? []);
  serviceRow(g, cx0, y + 45, cw, 19, top?.rows[1] ?? []);
  hLadder(g, cx0, y + 84, cw, 16, ladderMax, top?.points ?? 0);
  hLadder(g, cx0, y + 128, cw, 16, ladderMax, bot?.points ?? 0);
  serviceRow(g, cx0, y + 158, cw, 19, bot?.rows[0] ?? []);
  serviceRow(g, cx0, y + 179, cw, 19, bot?.rows[1] ?? []);
  teamLeftBlock(g, x + 3, y + 128, leftW, bot, true);
  if (set?.endedAt)
    g.text(`End time: ${hhmmss(set.endedAt)}`, cx0 + cw - 110, y + h - 14, { size: 6.5, bold: true, color: INK });

  // Court-switch rail: A:B at every switch, TTO flagged, unused rows crossed.
  const rx = x + w - railW - 4;
  const ry = y + 4;
  const rh = h - 8;
  g.rect(rx, ry, railW, 16, { fill: HEAD });
  g.ctext("Court switch", rx + railW / 2, ry + 5, { size: 4.4, bold: true });
  g.ctext("A : B", rx + railW / 2, ry + 11, { size: 4.4, bold: true });
  const rows = 8;
  const rrh = (rh - 16) / rows;
  for (let i = 0; i < rows; i++) {
    const cy = ry + 16 + i * rrh;
    g.rect(rx, cy, railW, rrh);
    const s = set?.switches[i];
    if (s) {
      g.ctext(`${s.score.a}:${s.score.b}`, rx + railW / 2, cy + rrh / 2, { size: 6, bold: true, color: INK });
      if (s.tto) {
        g.rect(rx + 1.5, cy + 1.5, railW - 3, rrh - 3, { lw: 1.1, color: INK });
        g.text("TTO", rx + railW - 13.5, cy + rrh - 6.5, { size: 3.6, bold: true, color: INK });
      }
    } else if (set && set.winner) {
      g.xmark(rx, cy, railW, rrh, { lw: 0.5 });
    }
  }
}

function teamLeftBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  t: HalfData | null,
  mirror: boolean,
) {
  const cwCols = [26, 15, 23, 23.5, 23.5, 23.5, 23.5];
  const colX = (i: number) => x + cwCols.slice(0, i).reduce((a, b) => a + b, 0);

  // Sanction cell fillers: score strings into the misconduct columns.
  const sanctionFor = (jersey: number | null, colIdx: number): string => {
    if (!t) return "";
    const list = t.sanctions.filter((s) => s.jersey === jersey && !s.kind.startsWith("DELAY"));
    // Column map: 2=Formal warning, 3..4=Pen, 5=Exp, 6=Disq.
    const byCol: Record<number, string[]> = { 2: [], 3: [], 5: [], 6: [] };
    for (const s of list) {
      if (s.kind === "MISCONDUCT_WARNING") byCol[2].push(`${s.score.a}:${s.score.b}`);
      else if (s.kind === "MISCONDUCT_PENALTY") byCol[3].push(`${s.score.a}:${s.score.b}`);
      else if (s.kind === "MISCONDUCT_EXPULSION") byCol[5].push(`${s.score.a}:${s.score.b}`);
      else byCol[6].push(`${s.score.a}:${s.score.b}`);
    }
    if (colIdx === 4) return byCol[3][1] ?? "";
    return byCol[colIdx]?.[0] ?? "";
  };

  const headerRow = (yy: number) => {
    const labels = ["Service order", "Player No.", "Formal warning", "Pen.", "Pen.", "Exp.", "Disq."];
    for (let i = 0; i < 7; i++) {
      g.rect(colX(i), yy, cwCols[i], 9, { fill: HEAD });
      g.ctext(labels[i], colX(i) + cwCols[i] / 2, yy + 4.5, { size: i < 3 ? 2.9 : 3.6 });
    }
    g.text("Misconduct sanctions", x + 64, yy - 4.6, { size: 3.4 });
  };
  const orderRow = (yy: number, ord: string, no: number | null) => {
    for (let i = 0; i < 7; i++) g.rect(colX(i), yy, cwCols[i], 12);
    g.ctext(ord, x + 13, yy + 6, { size: 6, bold: true });
    if (no != null) {
      g.ctext(no, x + 33.5, yy + 6, { size: 7, bold: true, color: INK });
      for (const ci of [2, 3, 4, 5, 6]) {
        const v = sanctionFor(no, ci);
        if (v) g.ctext(v, colX(ci) + cwCols[ci] / 2, yy + 6, { size: 4, color: INK });
      }
    }
  };
  const coachRow = (yy: number) => {
    for (let i = 0; i < 7; i++) g.rect(colX(i), yy, cwCols[i], 10);
    g.ctext("C", x + 13, yy + 5, { size: 5.5, bold: true });
    g.ctext("Coach", x + 33.5, yy + 5, { size: 3.6 });
  };
  const toDelayRow = (yy: number) => {
    g.rect(x, yy, 41, 26);
    g.ctext("Time", x + 20.5, yy + 5, { size: 4.6 });
    g.ctext("Out", x + 20.5, yy + 10, { size: 4.6 });
    if (t?.timeout)
      g.ctext(`${t.timeout.own}:${t.timeout.opp}`, x + 20.5, yy + 19, { size: 6, bold: true, color: INK });
    g.rect(x + 41, yy, w - 41, 8, { fill: HEAD });
    g.ctext("Delay sanctions", x + 41 + (w - 41) / 2, yy + 4, { size: 3.8 });
    const dl = ["Warn.", "Pen.", "Pen.", "Pen."];
    const dw = (w - 41) / 4;
    const delays = t ? t.sanctions.filter((s) => s.kind.startsWith("DELAY")) : [];
    const warn = delays.filter((s) => s.kind === "DELAY_WARNING");
    const pens = delays.filter((s) => s.kind === "DELAY_PENALTY");
    for (let i = 0; i < 4; i++) {
      g.rect(x + 41 + i * dw, yy + 8, dw, 8, { fill: HEAD });
      g.ctext(dl[i], x + 41 + i * dw + dw / 2, yy + 12, { size: 3.6 });
      g.rect(x + 41 + i * dw, yy + 16, dw, 10);
      const s = i === 0 ? warn[0] : pens[i - 1];
      if (s)
        g.ctext(`${s.score.a}:${s.score.b}`, x + 41 + i * dw + dw / 2, yy + 21, { size: 4, color: INK });
    }
  };
  const teamPointsRow = (yy: number) => {
    g.rect(x, yy, w, 16, { fill: HEAD });
    g.text("TEAM – POINTS", x + 2, yy + 2, { size: 3.6 });
    g.text("A or B", x + 44, yy + 1.6, { size: 2.8 });
    g.circle(x + 50, yy + 9.5, 4.8, { lw: 0.7, color: NAVY });
    if (t) {
      g.ctext(t.team, x + 50, yy + 9.5, { size: 5.5, bold: true, color: INK });
      g.text(t.code, x + 62, yy + 6, { size: 7, bold: true, color: INK });
    }
  };

  if (!mirror) {
    headerRow(y + 5);
    orderRow(y + 14, t?.orders[0][0] ?? "I", t?.orders[0][1] ?? null);
    orderRow(y + 27, t?.orders[1][0] ?? "III", t?.orders[1][1] ?? null);
    coachRow(y + 40);
    toDelayRow(y + 53);
    teamPointsRow(y + 82);
  } else {
    teamPointsRow(y);
    toDelayRow(y + 19);
    coachRow(y + 48);
    orderRow(y + 59, t?.orders[0][0] ?? "II", t?.orders[0][1] ?? null);
    orderRow(y + 72, t?.orders[1][0] ?? "IV", t?.orders[1][1] ?? null);
    headerRow(y + 87);
  }
}

function serviceRow(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  values: { score: number; circled: boolean }[],
) {
  const n = 21;
  const cw = w / n;
  for (let i = 0; i < n; i++) {
    g.rect(x + i * cw, y, cw, h);
    g.text(String(i + 1), x + i * cw + 1, y + 0.8, { size: 3, color: DIM });
    const v = values[i];
    if (v) {
      g.ctext(v.score, x + i * cw + cw / 2, y + h / 2 + 1, { size: 6.4, bold: true, color: INK });
      if (v.circled) g.ellipse(x + i * cw + cw / 2, y + h / 2 + 1, cw * 0.34, h * 0.36);
    }
  }
}

// ── page-2 blocks ────────────────────────────────────────────────────────────

function railLabel(g: Sheet, x: number, y: number, h: number, label: string) {
  g.fillRect(x, y, 12, h, HEAD);
  g.rect(x, y, 12, h);
  g.vlabel(label, x + 6, y + h / 2, { size: 6, bold: true });
}

function teamsBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  sheet: OfficialSheetData,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  railLabel(g, x, y, h, "TEAMS");
  const half = (w - 12) / 2;
  const set1 = sheet.sets.find((s) => s.setNumber === 1);
  for (const [i, side] of (["A", "B"] as const).entries()) {
    const roster = side === "A" ? report.rosterA : report.rosterB;
    const country = teamCode(
      side === "A" ? report.teamACountry : report.teamBCountry,
      side === "A" ? report.teamAName : report.teamBName,
    );
    const firstServerJersey = set1
      ? (side === "A" ? set1.serviceOrderA : set1.serviceOrderB)[0]
      : null;
    const tx = x + 12 + i * half;
    g.rect(tx, y, half, 10, { fill: HEAD });
    g.ctext(`${country}   (${side})`, tx + half / 2, y + 5, { size: 5.5, bold: true });
    let yy = y + 10;
    g.rect(tx, yy, 14, 8, { fill: HEAD });
    g.ctext("No.", tx + 7, yy + 4, { size: 3.8 });
    g.rect(tx + 14, yy, half - 14, 8, { fill: HEAD });
    g.text("Name", tx + 17, yy + 2.2, { size: 3.8 });
    yy += 8;
    for (let r = 0; r < 2; r++) {
      const p = roster[r];
      g.rect(tx, yy, 14, 11);
      g.rect(tx + 14, yy, half - 14, 11);
      if (p) {
        if (p.jerseyNumber != null)
          g.ctext(p.jerseyNumber, tx + 7, yy + 5.5, { size: 5.5, bold: true, color: INK });
        if (p.isCaptain) g.ellipse(tx + 7, yy + 5.5, 5, 4, { lw: 0.6 });
        // The asterisk marks the set-1 first server (confirmed convention).
        if (p.jerseyNumber != null && p.jerseyNumber === firstServerJersey)
          g.text("*", tx + 11.4, yy + 2.4, { size: 6.5, bold: true, color: INK });
        g.text(p.fullName.slice(0, 34), tx + 17, yy + 3, { size: 5, bold: true, color: INK });
      }
      yy += 11;
    }
    g.rect(tx, yy, 14, 10);
    g.rect(tx + 14, yy, half - 14, 10);
    g.ctext("C", tx + 7, yy + 5, { size: 5, bold: true });
    yy += 10;
    // Pre-match signatures: capture is spec/21 Phase D — blank boxes today.
    g.rect(tx, yy, half, 14);
    g.text("Captain's pre-match signature:", tx + 2, yy + 2, { size: 3.6 });
    yy += 14;
    g.rect(tx, yy, half, 14);
    g.text("Coach's pre-match signature:", tx + 2, yy + 2, { size: 3.6 });
  }
}

function resultsBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  sheet: OfficialSheetData,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  railLabel(g, x, y, h, "RESULTS");
  const bx = x + 12;
  const bw = w - 12;
  const heads = ["Timeouts", "Wins", "Points", "Set duration", "Points", "Wins", "Timeouts"];
  const rel = [0.12, 0.1, 0.12, 0.32, 0.12, 0.1, 0.12];
  const cws = rel.map((r) => r * bw);
  const colX: number[] = [];
  let cx = bx;
  for (const cwv of cws) {
    colX.push(cx);
    cx += cwv;
  }
  heads.forEach((hd, i) => {
    g.rect(colX[i], y, cws[i], 9, { fill: HEAD });
    g.ctext(hd, colX[i] + cws[i] / 2, y + 4.5, { size: 3.8, bold: true });
  });
  let yy = y + 9;
  const totals = { ta: 0, wa: 0, pa: 0, pb: 0, wb: 0, tb: 0, dur: 0 };
  const maxSet = Math.max(sheet.sets.length, 3);
  for (let n = 1; n <= Math.min(maxSet, 3); n++) {
    const s = sheet.sets.find((ss) => ss.setNumber === n);
    const dur = s ? durationMin(s.startedAt, s.endedAt) : null;
    const vals = s
      ? [
          s.timeouts.filter((t) => t.team === "A").length,
          s.winner === "A" ? 1 : 0,
          s.scoreA,
          `Set ${n}  (${dur ?? ""} min)`,
          s.scoreB,
          s.winner === "B" ? 1 : 0,
          s.timeouts.filter((t) => t.team === "B").length,
        ]
      : ["", "", "", `Set ${n}`, "", "", ""];
    if (s) {
      totals.ta += vals[0] as number;
      totals.wa += vals[1] as number;
      totals.pa += vals[2] as number;
      totals.pb += vals[4] as number;
      totals.wb += vals[5] as number;
      totals.tb += vals[6] as number;
      totals.dur += dur ?? 0;
    }
    vals.forEach((v, i) => {
      g.rect(colX[i], yy, cws[i], 10);
      g.ctext(v, colX[i] + cws[i] / 2, yy + 5, { size: 5, color: INK, bold: i === 3 });
    });
    yy += 10;
  }
  const tvals = [totals.ta, totals.wa, totals.pa, `Total  (${totals.dur} min)`, totals.pb, totals.wb, totals.tb];
  tvals.forEach((v, i) => {
    g.rect(colX[i], yy, cws[i], 10, { fill: HEAD });
    g.ctext(v, colX[i] + cws[i] / 2, yy + 5, { size: 5, bold: true, color: INK });
  });
  yy += 10;

  g.rect(bx, yy, bw * 0.25, 14);
  g.ctext("Match start time", bx + bw * 0.125, yy + 3.6, { size: 3.6 });
  g.ctext(hhmmss(report.startedAt), bx + bw * 0.125, yy + 9.6, { size: 5.4, bold: true, color: INK });
  g.rect(bx + bw * 0.25, yy, bw * 0.5, 14);
  g.ctext("Total match duration", bx + bw * 0.5, yy + 3.6, { size: 3.6 });
  const totalMin = durationMin(report.startedAt, report.finishedAt);
  g.ctext(totalMin != null ? `(${totalMin} min)` : "", bx + bw * 0.5, yy + 9.6, { size: 5.4, bold: true, color: INK });
  g.rect(bx + bw * 0.75, yy, bw * 0.25, 14);
  g.ctext("Match ending time", bx + bw * 0.875, yy + 3.6, { size: 3.6 });
  g.ctext(hhmmss(report.finishedAt), bx + bw * 0.875, yy + 9.6, { size: 5.4, bold: true, color: INK });
  yy += 14;

  g.rect(bx, yy, bw, y + h - yy);
  g.text("Winning team:", bx + 3, yy + 4, { size: 5 });
  const winnerName =
    report.winner === "A" ? report.teamAName : report.winner === "B" ? report.teamBName : "";
  const winnerCountry =
    report.winner === "A"
      ? teamCode(report.teamACountry, report.teamAName)
      : report.winner === "B"
        ? teamCode(report.teamBCountry, report.teamBName)
        : "";
  if (report.winner) {
    // Winner-first set score, as on the paper sheet ("… LAT 2:1").
    const first = report.winner === "B" ? report.setsWonB : report.setsWonA;
    const second = report.winner === "B" ? report.setsWonA : report.setsWonB;
    g.text(`${winnerName}   ${winnerCountry}   ${first}:${second}`, bx + 42, yy + 3.4, {
      size: 6.5,
      bold: true,
      color: INK,
    });
  }
}

const BEACH_ROLES: [string, string][] = [
  ["FIRST_REFEREE", "First referee"],
  ["SECOND_REFEREE", "Second referee"],
  ["SCORER", "Scorer"],
  ["ASSISTANT_SCORER", "Assistant scorer"],
];

function approvalBlock(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
) {
  g.rect(x, y, w, h, { lw: 0.9 });
  railLabel(g, x, y, h, "APPROVAL");
  const bx = x + 12;
  const bw = w - 12;
  const cws = [bw * 0.22, bw * 0.34, bw * 0.14, bw * 0.3];
  const colX = [bx, bx + cws[0], bx + cws[0] + cws[1], bx + cws[0] + cws[1] + cws[2]];
  const heads = ["Officials", "Name", "Country", "Signature"];
  heads.forEach((hd, i) => {
    g.rect(colX[i], y, cws[i], 8, { fill: HEAD });
    g.ctext(hd, colX[i] + cws[i] / 2, y + 4, { size: 4, bold: true });
  });
  let yy = y + 8;
  const officials = new Map(report.approval.officials.map((o) => [o.role, o]));
  const sigByRole = new Map(report.approval.signatures.map((s) => [s.role, s]));
  for (const [role, label] of BEACH_ROLES) {
    const o = officials.get(role);
    g.rect(colX[0], yy, cws[0], 10);
    g.text(label, colX[0] + 2, yy + 3, { size: 4.2 });
    g.rect(colX[1], yy, cws[1], 10);
    if (o) g.text(o.name.slice(0, 30), colX[1] + 2, yy + 2.8, { size: 4.6, color: INK });
    g.rect(colX[2], yy, cws[2], 10);
    if (o?.country || o?.level)
      g.ctext(o.country ?? o.level ?? "", colX[2] + cws[2] / 2, yy + 5, { size: 4.6, color: INK });
    g.rect(colX[3], yy, cws[3], 10);
    if (role === "FIRST_REFEREE") {
      const sig = sigByRole.get("FIRST_REFEREE");
      if (sig?.strokes)
        drawSignatureInBox(g.d, sig.strokes, { x: colX[3] + 2, y: yy + 0.5, w: cws[3] - 4, h: 9 });
    }
    yy += 10;
  }
  // Line judges (names only, as on the paper sheet).
  g.rect(bx, yy, cws[0], 16);
  g.text("Line judges", bx + 2, yy + 5.5, { size: 4.4 });
  const ljw = (bw - cws[0]) / 2;
  for (let i = 0; i < 4; i++) {
    const lx = bx + cws[0] + (i % 2) * ljw;
    const ly = yy + Math.floor(i / 2) * 8;
    g.rect(lx, ly, ljw, 8);
    const o = officials.get(`LINE_JUDGE_${i + 1}`);
    g.text(`${i + 1}  ${o ? o.name.slice(0, 24) : ""}`, lx + 2, ly + 2, { size: 4.2, color: o ? INK : NAVY });
  }
  yy += 16;
  const capH = y + h - yy;
  const half = bw / 2;
  (["TEAM_A_CAPTAIN", "TEAM_B_CAPTAIN"] as const).forEach((role, i) => {
    const cx2 = bx + i * half;
    g.rect(cx2, yy, half, capH);
    g.text("Captain post-match signature:", cx2 + 2, yy + 2, { size: 3.8 });
    const sig = sigByRole.get(role);
    if (sig?.strokes)
      drawSignatureInBox(g.d, sig.strokes, { x: cx2 + 8, y: yy + 6, w: half - 16, h: capH - 10 });
    if (sig && !sig.strokes)
      g.text(sig.intent === "REFUSED" ? "refused to sign" : sig.signerName, cx2 + 8, yy + capH / 2, {
        size: 4.2,
        color: INK,
      });
  });
}

function remarksAndToss(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  report: MatchReportData,
  sheet: OfficialSheetData,
) {
  const remH = h - 30;
  g.rect(x, y, w, remH, { lw: 0.9 });
  g.text("Remarks:", x + 4, y + 4, { size: 6.5, bold: true });
  const sigRemarks = report.approval.signatures
    .filter((s) => s.remarks)
    .map((s) => `${s.role}: ${s.remarks}`);
  const forfeitNote = sheet.forfeit
    ? [
        `${sheet.forfeit.reason === "RETIREMENT" ? "Retirement" : "Forfeit"}: team ${sheet.forfeit.team}`,
      ]
    : [];
  const all = [...sheet.remarks, ...forfeitNote, ...sigRemarks];
  g.text("Additional information attached", x + w - 105, y + 5, { size: 4 });
  g.rect(x + w - 16, y + 2, 11, 11);
  if (all.length > 4) g.xmark(x + w - 16, y + 2, 11, 11);
  let ry = y + 18;
  for (const line of all.slice(0, 16)) {
    g.text(line.slice(0, 110), x + 4, ry, { size: 5.2, color: INK });
    ry += 8;
  }

  const cy = y + remH + 3;
  g.rect(x, cy, w, h - remH - 3, { lw: 0.9 });
  g.text("Winner of Coin Toss:", x + 4, cy + 9, { size: 6, bold: true });
  const decider = sheet.sets.find((s) => s.tossWinner)?.tossWinner ?? null;
  g.text("Set 1", x + 78, cy + 9, { size: 5.5 });
  g.circle(x + 98, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  if (sheet.tossWinnerSet1)
    g.ctext(sheet.tossWinnerSet1, x + 98, cy + 11.5, { size: 5.5, bold: true, color: INK });
  g.text("Decider", x + 112, cy + 9, { size: 5.5 });
  g.circle(x + 140, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  if (decider) g.ctext(decider, x + 140, cy + 11.5, { size: 5.5, bold: true, color: INK });
  g.text("Improper request:", x + 200, cy + 9, { size: 6, bold: true });
  const irA = sheet.improperRequests.some((r) => r.team === "A");
  const irB = sheet.improperRequests.some((r) => r.team === "B");
  g.circle(x + 268, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  g.ctext("A", x + 268, cy + 11.5, { size: 4, color: DIM });
  if (irA) g.xmark(x + 262.5, cy + 6, 11, 11, { lw: 0.8 });
  g.circle(x + 284, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  g.ctext("B", x + 284, cy + 11.5, { size: 4, color: DIM });
  if (irB) g.xmark(x + 278.5, cy + 6, 11, 11, { lw: 0.8 });
}
