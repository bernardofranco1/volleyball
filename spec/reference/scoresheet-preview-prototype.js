/* Prototype of spec/21 official e-scoresheets (indoor VSR-style + beach international style).
 * Rendered with pdfkit (same stack as src/lib/scoresheet-pdf.ts). MOCK DATA mirroring the
 * two reference matches. Layout fidelity target: structural look-alike preview.
 */
const PDFDocument = require("/home/fivb1/volleyball/node_modules/pdfkit");
const fs = require("fs");

const NAVY = "#2b3f5c"; // pre-printed template
const HEAD = "#e8eef7"; // header fills
const INK = "#101010"; // recorded data
const DIM = "#6b7686"; // pre-printed ladder numbers

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const FONT_R = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const FONT_B = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf";
const FONT_I = "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf";

class G {
  constructor(doc) {
    this.d = doc;
    doc.registerFont("S", FONT_R);
    doc.registerFont("SB", FONT_B);
    doc.registerFont("SI", FONT_I);
  }
  rect(x, y, w, h, { lw = 0.6, color = NAVY, fill = null } = {}) {
    const d = this.d;
    if (fill) { d.save().rect(x, y, w, h).fill(fill).restore(); }
    d.save().lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke().restore();
  }
  fillRect(x, y, w, h, fill) { this.d.save().rect(x, y, w, h).fill(fill).restore(); }
  line(x1, y1, x2, y2, { lw = 0.6, color = NAVY } = {}) {
    this.d.save().lineWidth(lw).strokeColor(color).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
  }
  text(s, x, y, { size = 6, bold = false, oblique = false, color = NAVY, w, align = "left" } = {}) {
    const font = bold ? "SB" : oblique ? "SI" : "S";
    this.d.font(font).fontSize(size).fillColor(color);
    this.d.text(String(s), x, y, { width: w, align, lineBreak: !!w });
  }
  ctext(s, cx, cy, { size = 6, bold = false, color = NAVY } = {}) {
    const font = bold ? "SB" : "S";
    this.d.font(font).fontSize(size).fillColor(color);
    const tw = this.d.widthOfString(String(s));
    this.d.text(String(s), cx - tw / 2, cy - size * 0.36, { lineBreak: false });
  }
  circle(cx, cy, r, { lw = 0.7, color = INK } = {}) {
    this.d.save().lineWidth(lw).strokeColor(color).circle(cx, cy, r).stroke().restore();
  }
  ellipse(cx, cy, rx, ry, { lw = 0.7, color = INK } = {}) {
    this.d.save().lineWidth(lw).strokeColor(color).ellipse(cx, cy, rx, ry).stroke().restore();
  }
  slash(x, y, w, h, { lw = 0.7, color = INK } = {}) {
    this.line(x + w * 0.18, y + h * 0.84, x + w * 0.82, y + h * 0.16, { lw, color });
  }
  xmark(x, y, w, h, { lw = 0.7, color = INK } = {}) {
    this.line(x + w * 0.2, y + h * 0.2, x + w * 0.8, y + h * 0.8, { lw, color });
    this.line(x + w * 0.2, y + h * 0.8, x + w * 0.8, y + h * 0.2, { lw, color });
  }
  checkbox(x, y, s, checked) {
    this.rect(x, y, s, s, { lw: 0.6 });
    if (checked) this.xmark(x, y, s, s, { lw: 0.8 });
  }
  squiggle(x, y, w, h, seed) {
    const r = prng(seed);
    const d = this.d;
    d.save().lineWidth(0.9).strokeColor(INK);
    let cx = x + w * 0.1, cy = y + h * 0.6;
    d.moveTo(cx, cy);
    for (let i = 0; i < 4; i++) {
      const nx = x + w * (0.15 + 0.22 * (i + r()));
      d.bezierCurveTo(cx + 6, cy - h * (0.5 + r() * 0.5), nx - 6, cy + h * (0.4 + r() * 0.4), Math.min(nx, x + w * 0.95), y + h * (0.3 + r() * 0.5));
      cx = nx; cy = y + h * (0.3 + r() * 0.5);
    }
    d.stroke().restore();
  }
  watermark(w, h, label) {
    const d = this.d;
    d.save().rotate(-18, { origin: [w / 2, h / 2] })
      .font("SB").fontSize(46).fillColor("#8aa0c0").fillOpacity(0.13);
    const tw = d.widthOfString(label);
    d.text(label, w / 2 - tw / 2, h / 2 - 20, { lineBreak: false });
    d.restore().fillOpacity(1);
  }
  footer(pageW, pageH, s) {
    this.text(s, 12, pageH - 9, { size: 4.4, color: "#8b95a6" });
  }
}

/* ============================ INDOOR ============================ */

const IND = {
  comp: "Women's Volleyball Nations League 2026", phase: "Final 1-2",
  city: "Macao", country: "Macao, China", hall: "East Asian Games Dome",
  matchNo: "116", date: "2026-07-26", time: "19:30",
  sets: [
    { n: 1, start: "19:30", end: "19:58",
      left: { code: "BRA", side: "L", serve: "R", points: 25, lineup: [17, 2, 7, 14, 11, 9],
        subs: [{ col: 2, no: 3, score: "23:22", ret: "23:22" }, { col: 5, no: 16, score: "23:22" }],
        rounds: [["X", 1, 4, 5, 6, 7], [9, 10, 11, 14, 17, 18], [19, 22, 23, 24, { v: 25, c: 1 }, null], []],
        tos: ["23:20", "24:23"] },
      right: { code: "TUR", side: "R", serve: "S", points: 23, lineup: [12, 7, 18, 4, 22, 8],
        subs: [{ col: 2, no: 3, score: "19:23" }, { col: 3, no: 6, score: "15:18" }, { col: 4, no: 10, score: "18:22" }],
        rounds: [[0, 1, 3, 4, 5, 7], [8, 11, 12, 14, 15, 16], [17, 18, 22, { v: 23, c: 1 }, null, null], []],
        tos: ["14:17", "17:21"] } },
    { n: 2, start: "20:01", end: "20:30",
      left: { code: "TUR", side: "L", serve: "R", points: 25, lineup: [22, 8, 12, 7, 18, 4],
        subs: [{ col: 1, no: 10, score: "17:19" }, { col: 5, no: 6, score: "21:21" }],
        rounds: [["X", 2, 5, 8, 10, 12], [14, 16, 18, 20, 22, 24], [{ v: 25, c: 1 }, null, null, null, null, null], []],
        tos: ["20:20", "24:22"] },
      right: { code: "BRA", side: "R", serve: "S", points: 23, lineup: [9, 17, 2, 7, 14, 11],
        subs: [{ col: 0, no: 16, score: "21:24" }],
        rounds: [[0, 3, 5, 7, 9, 11], [13, 15, 17, 19, 21, 22], [{ v: 23, c: 1 }, null, null, null, null, null], []],
        tos: ["8:10", "17:20"] } },
    { n: 3, start: "20:35", end: "21:05",
      left: { code: "BRA", side: "L", serve: "R", points: 24, lineup: [17, 2, 7, 14, 11, 9],
        subs: [{ col: 2, no: 15, score: "22:23" }, { col: 0, no: 16, score: "21:23" }],
        rounds: [["X", 1, 3, 6, 9, 12], [14, 15, 17, 19, 21, 23], [{ v: 24, c: 1 }, null, null, null, null, null], []],
        tos: ["20:21", "21:23"] },
      right: { code: "TUR", side: "R", serve: "S", points: 26, lineup: [12, 7, 18, 4, 22, 8],
        subs: [{ col: 1, no: 6, score: "19:18" }, { col: 2, no: 10, score: "15:15", ret: "24:23" }],
        rounds: [[0, 2, 4, 7, 10, 13], [15, 16, 18, 20, 22, 24], [{ v: 26, c: 1 }, null, null, null, null, null], []],
        tos: ["5:8", "23:23"] } },
    { n: 4, start: "21:08", end: "21:36",
      left: { code: "TUR", side: "L", serve: "R", points: 25, lineup: [22, 8, 12, 7, 18, 4],
        subs: [{ col: 0, no: 10, score: "21:23" }],
        rounds: [["X", 3, 6, 9, 12, 15], [17, 19, 21, 23, { v: 25, c: 1 }, null], [], []],
        tos: ["13:10", "18:19"] },
      right: { code: "BRA", side: "R", serve: "S", points: 21, lineup: [9, 17, 2, 7, 14, 11],
        subs: [{ col: 1, no: 16, score: "2:8" }],
        rounds: [[0, 2, 4, 6, 8, 10], [12, 14, 16, 18, 20, { v: 21, c: 1 }], [], []],
        tos: ["1:5", "19:21"] } },
  ],
  results: {
    rows: [
      { l: { t: 2, s: 2, w: 1, p: 25 }, set: "1", dur: 28, r: { p: 23, w: 0, s: 5, t: 2 } },
      { l: { t: 2, s: 6, w: 0, p: 23 }, set: "2", dur: 28, r: { p: 25, w: 1, s: 2, t: 2 } },
      { l: { t: 2, s: 7, w: 0, p: 24 }, set: "3", dur: 29, r: { p: 26, w: 1, s: 5, t: 2 } },
      { l: { t: 2, s: 4, w: 0, p: 21 }, set: "4", dur: 27, r: { p: 25, w: 1, s: 3, t: 2 } },
      { l: null, set: "5", dur: null, r: null },
    ],
    totals: { l: { t: 8, s: 19, w: 1, p: 93 }, dur: 112, r: { p: 99, w: 3, s: 15, t: 8 } },
    startT: "19:30", endT: "21:36", total: "2:06", winner: "Türkiye", score: "3:1",
  },
  teamL: { code: "BRA", name: "Brazil" }, teamR: { code: "TUR", name: "Türkiye" },
  rosterR: [[3, "Özbay Cansu", 1], [4, "Vargas Melissa Teresa"], [6, "Sahin Saliha"], [7, "Baladin Hande"], [8, "Jack Sinead"], [10, "Akarcesme Eylül"], [12, "Şahin Elif"], [15, "Uyanik Deniz"], [16, "Ozden Berka Buse"], [18, "Gunes Zehra"], [20, "Erkek Yaprak"], [22, "Aydin İlkin"], [91, "Basyolcu Defne"]],
  rosterL: [[2, "Duarte Alecrim Diana"], [3, "Silva Carneiro Macris", 1], [4, "Viezel Lorena Giovana"], [7, "Montibeller Rosamaria"], [9, "Ratzke Roberta Silva"], [11, "da Silva Nezzo Luzia"], [14, "Menezes Oliveira de So."], [15, "Wenk Hoengen Helena"], [16, "Nascimento Kisy"], [17, "Bergmann Julia Isabelle"], [20, "Basso Maiara"], [26, "Besen Larissa"]],
  liberosR: [[1, "Orge Gizem"]], liberosL: [[22, "de Arruda M. da Silva M."], [5, "Araujo Natália"]],
  benchR: [["C1", "Santarelli Daniele"], ["A1", "Mora Maurizio"], ["A2", "Vatansever Recep"], ["T1", "Gatti Francesco"], ["A3", "Flisi Diego"], ["", ""]],
  benchL: [["C1", "Guimaraes José Roberto"], ["A1", "Barros Junior Paulo"], ["A2", "De Souza Gonzaga W."], ["D1", "Nardelli Julio Cesar"], ["P2", "Botelho Caique"], ["T3", "Melato Bernardes de F."]],
  officials: [
    ["First referee", "Cespedes Lassi Denny F.", "DOM", 11], ["Second referee", "Simonovic Vladimir", "SUI", null],
    ["Scorer", "Yu Kit Ian", "MAC", 12], ["Third referee", "Ovuka Sinisa", "BIH", null],
    ["Assistant scorer", "Ung Seng Iat", "MAC", 13], ["Challenge referee", "Rapisarda Daniele", "ITA", null],
  ],
  remarks: "Temperature: 23°C, humidity: 58%",
};

function indoorTeamBlock(g, x, y, w, h, t, showStart, startEnd) {
  const gridW = 120, colW = 20, stripW = w - gridW - 6;
  // header row
  const hy = y, hh = 12;
  g.rect(x, hy, 36, hh); g.text(showStart ? "START" : "END", x + 1.5, hy + 1.2, { size: 3.4 });
  g.text("time", x + 1.5, hy + 5, { size: 3.4 });
  g.text(startEnd, x + 13, hy + 3.6, { size: 6, bold: true, color: INK });
  g.rect(x + 36, hy, 24, hh, { fill: HEAD }); g.ctext("TEAM", x + 48, hy + 6, { size: 4.5 });
  g.rect(x + 60, hy, 26, hh); g.ctext(t.code, x + 73, hy + 6, { size: 6.5, bold: true, color: INK });
  g.rect(x + 86, hy, 17, hh); g.circle(x + 94.5, hy + 6, 4.4, { lw: 0.6, color: NAVY }); g.ctext(t.side, x + 94.5, hy + 6, { size: 5.5, bold: true, color: INK });
  g.rect(x + 103, hy, 17, hh); g.circle(x + 111.5, hy + 6, 4.4, { lw: 0.6, color: NAVY }); g.ctext(t.serve, x + 111.5, hy + 6, { size: 5.5, bold: true, color: INK });
  g.rect(x + gridW, hy, stripW + 6, hh, { fill: HEAD }); g.ctext("POINTS", x + gridW + (stripW + 6) / 2, hy + 6, { size: 4.5 });

  // roman header
  let yy = y + hh;
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, yy, colW, 8, { fill: HEAD });
    g.ctext(roman[c], x + c * colW + colW / 2, yy + 4, { size: 4.6, bold: true });
  }
  yy += 8;
  // starting players
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, yy, colW, 12);
    if (t.lineup[c] != null) g.ctext(t.lineup[c], x + c * colW + colW / 2, yy + 6, { size: 7, bold: true, color: INK });
  }
  yy += 12;
  // subs rows: player no + score at change (2 rows)
  const subNo = yy, subS1 = yy + 9, subS2 = yy + 18;
  for (let c = 0; c < 6; c++) {
    g.rect(x + c * colW, subNo, colW, 9);
    g.rect(x + c * colW, subS1, colW, 9);
    g.rect(x + c * colW, subS2, colW, 9);
  }
  for (const s of t.subs || []) {
    const cx = x + s.col * colW + colW / 2;
    g.ctext(s.no, cx, subNo + 4.5, { size: 5.8, bold: true, color: INK });
    if (s.ret) g.ellipse(cx, subNo + 4.5, 5.4, 3.8, { lw: 0.6 });
    g.ctext(s.score, cx, subS1 + 4.5, { size: 4.4, color: INK });
    if (s.ret) g.ctext(s.ret, cx, subS2 + 4.5, { size: 4.4, color: INK });
  }
  yy += 27;
  // service rounds (4 rows)
  const rh = 12.4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const cx = x + c * colW, cy = yy + r * rh;
      g.rect(cx, cy, colW, rh);
      const v = (t.rounds[r] || [])[c];
      if (v == null) continue;
      if (v === "X") { g.xmark(cx, cy, colW, rh); continue; }
      const val = typeof v === "object" ? v.v : v;
      g.ctext(val, cx + colW / 2, cy + rh / 2, { size: 5.6, color: INK });
      if (typeof v === "object" && v.c) g.ellipse(cx + colW / 2, cy + rh / 2, 6.4, 4.6);
    }
  }
  yy += 4 * rh;
  // timeout row
  g.rect(x, yy, 12, h - (yy - y), { fill: HEAD }); g.ctext("\"T\"", x + 6, yy + (h - (yy - y)) / 2, { size: 5, bold: true });
  const tw = (gridW - 12) / 2;
  for (let i = 0; i < 2; i++) {
    g.rect(x + 12 + i * tw, yy, tw, h - (yy - y));
    if (t.tos && t.tos[i]) g.ctext(t.tos[i], x + 12 + i * tw + tw / 2, yy + (h - (yy - y)) / 2, { size: 5.4, color: INK });
  }
  // points strip 1..48, two columns
  const sx = x + gridW + 3, sy = y + hh, sh = h - hh, rows = 24, rH = sh / rows, cW = (stripW + 3) / 2;
  g.rect(sx - 3, sy, stripW + 6, sh);
  g.line(sx - 3 + cW + 1.5, sy, sx - 3 + cW + 1.5, sy + sh, { lw: 0.3 });
  for (let n = 1; n <= 48; n++) {
    const col = n <= 24 ? 0 : 1, row = (n - 1) % 24;
    const cx = sx - 3 + col * (cW + 1.5), cy = sy + row * rH;
    g.ctext(n, cx + cW / 2, cy + rH / 2, { size: 3.4, color: DIM });
    if (n <= t.points) {
      g.line(cx + cW * 0.32, cy + rH * 0.82, cx + cW * 0.68, cy + rH * 0.18, { lw: 0.45, color: INK });
      if (n === t.points) g.ellipse(cx + cW / 2, cy + rH / 2, cW * 0.3, rH * 0.6, { lw: 0.6 });
    }
  }
  // one straight strike per column over the unused tail
  for (const [colStart, colEnd, col] of [[1, 24, 0], [25, 48, 1]]) {
    const from = Math.max(t.points + 1, colStart);
    if (from > colEnd) continue;
    const cx = sx - 3 + col * (cW + 1.5) + cW / 2;
    const y1 = sy + ((from - colStart) % 24) * rH + 0.6;
    const y2 = sy + (colEnd - colStart + 1) * rH - 0.6;
    g.line(cx, y1, cx, y2, { lw: 0.6, color: INK });
  }
}

function indoorSetPanel(g, x, y, w, h, set) {
  g.rect(x, y, w, h, { lw: 0.9 });
  // left rail
  g.rect(x, y, 11, h, { fill: HEAD });
  g.d.save().rotate(-90, { origin: [x + 5.5, y + h / 2] });
  g.ctext(`Set ${set.n}`, x + 5.5, y + h / 2, { size: 7, bold: true });
  g.d.restore();
  // label rail
  const lx = x + 11, lw = 34;
  g.rect(lx, y, lw, h);
  const labels = [
    ["Service order", 13.5], ["Nr of starting player", 22], ["Substitutes:", 32], ["Nr of player", 36.5], ["Score at change", 45],
    ["Service round  1·5", 62], ["2·6", 74], ["3·7", 86], ["4·8", 99], ["Time-outs", 111],
  ];
  for (const [s, dy] of labels) g.text(s, lx + 1.2, y + dy, { size: 3.3, w: lw - 2 });
  const bx = lx + lw + 1, bw = (w - (lw + 12) - 4) / 2;
  indoorTeamBlock(g, bx, y + 1, bw, h - 2, set.left, true, set.start);
  indoorTeamBlock(g, bx + bw + 2, y + 1, bw, h - 2, set.right, false, set.end);
}

function indoorSet5Panel(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.rect(x, y, 11, h, { fill: HEAD });
  g.d.save().rotate(-90, { origin: [x + 5.5, y + h / 2] });
  g.ctext("Set 5", x + 5.5, y + h / 2, { size: 7, bold: true });
  g.d.restore();
  const bw = (w - 15) / 3;
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  const titles = ["START time      TEAM", "Change side — points at chg.", "END time      TEAM"];
  for (let b = 0; b < 3; b++) {
    const bx = x + 13 + b * bw;
    g.rect(bx, y + 2, bw - 2, 12);
    g.text(titles[b], bx + 2, y + 6, { size: 3.8 });
    for (let c = 0; c < 6; c++) {
      const cw = (bw - 2 - 26) / 6;
      g.rect(bx + c * cw, y + 14, cw, 8, { fill: HEAD });
      g.ctext(roman[c], bx + c * cw + cw / 2, y + 18, { size: 4.4, bold: true });
      g.rect(bx + c * cw, y + 22, cw, 11);
      for (let r = 0; r < 4; r++) g.rect(bx + c * cw, y + 33 + r * 12, cw, 12);
    }
    // strip 1..30
    const sx = bx + bw - 28, sy = y + 14, sh = h - 18, rows = 15, rH = sh / rows, cW2 = 13;
    g.rect(sx, sy, 26, sh);
    g.line(sx + 13, sy, sx + 13, sy + sh, { lw: 0.3 });
    for (let n = 1; n <= 30; n++) {
      const col = n <= 15 ? 0 : 1, row = (n - 1) % 15;
      g.ctext(n, sx + col * cW2 + cW2 / 2, sy + row * rH + rH / 2, { size: 3.4, color: DIM });
    }
  }
  g.text("Set 5 not played — panel remains pre-printed", x + 15, y + h - 8, { size: 4, oblique: true, color: DIM });
}

function indoorResults(g, x, y, w, h, R) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD); g.ctext("RESULTS", x + w / 2, y + 5.5, { size: 6.5, bold: true });
  let yy = y + 11;
  g.rect(x, yy, w, 10);
  g.ctext(`TEAM  ${IND.teamL.code}  (L)`, x + w * 0.25, yy + 5, { size: 5, bold: true, color: INK });
  g.ctext(`(R)  ${IND.teamR.code}  TEAM`, x + w * 0.75, yy + 5, { size: 5, bold: true, color: INK });
  yy += 10;
  const cols = ["T", "S", "W", "P", "SET (Dur)", "P", "W", "S", "T"];
  const cw = [14, 14, 14, 16, (w - 2 * 58 - 0), 16, 14, 14, 14];
  const totalW = cw.reduce((a, b) => a + b, 0);
  const scale = w / totalW;
  let cx = x;
  const colX = cols.map((_, i) => { const v = cx; cx += cw[i] * scale; return v; });
  for (let i = 0; i < cols.length; i++) {
    g.rect(colX[i], yy, cw[i] * scale, 9, { fill: HEAD });
    g.ctext(cols[i], colX[i] + cw[i] * scale / 2, yy + 4.5, { size: 4.2, bold: true });
  }
  yy += 9;
  const rowH = 11;
  for (const r of R.rows) {
    const vals = r.l ? [r.l.t, r.l.s, r.l.w, r.l.p, `${r.set}   ( ${r.dur} )`, r.r.p, r.r.w, r.r.s, r.r.t] : ["", "", "", "", `${r.set}   (      )`, "", "", "", ""];
    for (let i = 0; i < 9; i++) {
      g.rect(colX[i], yy, cw[i] * scale, rowH);
      g.ctext(vals[i], colX[i] + cw[i] * scale / 2, yy + rowH / 2, { size: 5.2, color: i === 4 ? NAVY : INK });
    }
    yy += rowH;
  }
  const tvals = [R.totals.l.t, R.totals.l.s, R.totals.l.w, R.totals.l.p, `Total ( ${R.totals.dur} m)`, R.totals.r.p, R.totals.r.w, R.totals.r.s, R.totals.r.t];
  for (let i = 0; i < 9; i++) {
    g.rect(colX[i], yy, cw[i] * scale, rowH, { fill: HEAD });
    g.ctext(tvals[i], colX[i] + cw[i] * scale / 2, yy + rowH / 2, { size: 5.2, bold: true, color: i === 4 ? NAVY : INK });
  }
  yy += rowH + 3;
  const thW = (w - 8) / 3;
  const times = [["Match starting time", R.startT], ["Match ending time", R.endT], ["Match total time", R.total]];
  for (let i = 0; i < 3; i++) {
    g.rect(x + 4 + i * thW, yy, thW - 2, 18);
    g.ctext(times[i][0], x + 4 + i * thW + (thW - 2) / 2, yy + 4.5, { size: 3.8 });
    g.ctext(times[i][1], x + 4 + i * thW + (thW - 2) / 2, yy + 12, { size: 6.5, bold: true, color: INK });
  }
  yy += 22;
  g.rect(x + 4, yy, w - 8, 16);
  g.text("WINNER", x + 8, yy + 5.5, { size: 5.5, bold: true });
  g.ctext(R.winner, x + w / 2, yy + 8, { size: 8, bold: true, color: INK });
  g.ctext(R.score, x + w - 22, yy + 8, { size: 8, bold: true, color: INK });
}

function indoorTeams(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD);
  g.ctext(`(R) ${IND.teamR.code}    TEAMS    ${IND.teamL.code} (L)`, x + w / 2, y + 5.5, { size: 6, bold: true });
  let yy = y + 11;
  const half = w / 2;
  const rows = Math.max(IND.rosterR.length, IND.rosterL.length);
  const rh = 8.6;
  g.rect(x, yy, half, 8, { fill: HEAD }); g.text("No. Name of player", x + 3, yy + 2.4, { size: 4 });
  g.rect(x + half, yy, half, 8, { fill: HEAD }); g.text("No. Name of player", x + half + 3, yy + 2.4, { size: 4 });
  yy += 8;
  for (let i = 0; i < rows; i++) {
    for (const [side, roster] of [[0, IND.rosterR], [1, IND.rosterL]]) {
      const rx = x + side * half;
      g.rect(rx, yy, 13, rh); g.rect(rx + 13, yy, half - 13, rh);
      const p = roster[i];
      if (p) {
        g.ctext(p[0], rx + 6.5, yy + rh / 2, { size: 5, bold: true, color: INK });
        if (p[2]) g.ellipse(rx + 6.5, yy + rh / 2, 5, 3.6, { lw: 0.6 });
        g.text(p[1], rx + 15, yy + rh / 2 - 2, { size: 4.6, color: INK });
      }
    }
    yy += rh;
  }
  g.rect(x, yy, w, 8, { fill: HEAD }); g.ctext("LIBERO PLAYERS (\"L\")", x + w / 2, yy + 4, { size: 4.4, bold: true });
  yy += 8;
  for (let i = 0; i < 2; i++) {
    for (const [side, libs] of [[0, IND.liberosR], [1, IND.liberosL]]) {
      const rx = x + side * half;
      g.rect(rx, yy, 13, rh); g.rect(rx + 13, yy, half - 13, rh);
      const p = libs[i];
      if (p) { g.ctext(p[0], rx + 6.5, yy + rh / 2, { size: 5, bold: true, color: INK }); g.text(p[1], rx + 15, yy + rh / 2 - 2, { size: 4.6, color: INK }); }
    }
    yy += rh;
  }
  g.rect(x, yy, w, 8, { fill: HEAD }); g.ctext("OFFICIALS", x + w / 2, yy + 4, { size: 4.4, bold: true });
  yy += 8;
  const brh = 7.6;
  for (let i = 0; i < 6; i++) {
    for (const [side, bench] of [[0, IND.benchR], [1, IND.benchL]]) {
      const rx = x + side * half;
      g.rect(rx, yy, 13, brh); g.rect(rx + 13, yy, half - 13, brh);
      const p = bench[i];
      if (p && p[0]) { g.ctext(p[0], rx + 6.5, yy + brh / 2, { size: 4.4, bold: true, color: INK }); g.text(p[1], rx + 15, yy + brh / 2 - 1.8, { size: 4.2, color: INK }); }
    }
    yy += brh;
  }
  g.rect(x, yy, w, 8, { fill: HEAD }); g.ctext("SIGNATURES (pre-match)", x + w / 2, yy + 4, { size: 4.4, bold: true });
  yy += 8;
  const sh = y + h - yy;
  for (const [i, label] of [["0", "Team captain"], ["1", "Coach"]].entries()) {
    for (const side of [0, 1]) {
      const rx = x + side * half;
      const cy = yy + i * (sh / 2);
      g.rect(rx, cy, half, sh / 2);
      g.text(label[1], rx + 2, cy + 1.6, { size: 3.6 });
      g.squiggle(rx + 24, cy + 1, half - 30, sh / 2 - 3, 40 + i * 7 + side * 13);
    }
  }
}

function indoorSanctions(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 11, HEAD); g.ctext("SANCTIONS", x + w / 2, y + 5.5, { size: 6, bold: true });
  let yy = y + 11;
  const heads = ["W (Warn)", "P (Pena)", "E (Expu)", "D (Disq)", "L/R", "SET", "SCORE"];
  const cw = w / 7;
  for (let i = 0; i < 7; i++) {
    g.rect(x + i * cw, yy, cw, 10, { fill: HEAD });
    g.ctext(heads[i].split(" ")[0], x + i * cw + cw / 2, yy + 3, { size: 3.8, bold: true });
    if (heads[i].includes("(")) g.ctext(heads[i].split(" ")[1], x + i * cw + cw / 2, yy + 7, { size: 2.8 });
  }
  yy += 10;
  const rows = 6, rh2 = (h - 11 - 10 - 24) / rows;
  for (let r = 0; r < rows; r++) { for (let i = 0; i < 7; i++) g.rect(x + i * cw, yy + r * rh2, cw, rh2); }
  yy += rows * rh2;
  g.rect(x, yy, w, 24);
  g.text("IMPROPER REQUEST", x + 3, yy + 3, { size: 4.6, bold: true });
  g.text("TEAM", x + 8, yy + 13, { size: 4.6 });
  g.circle(x + 26, yy + 15, 4.5, { lw: 0.6, color: NAVY }); g.ctext("L", x + 26, yy + 15, { size: 4.6 });
  g.ctext(":", x + 36, yy + 15, { size: 5 });
  g.circle(x + 46, yy + 15, 4.5, { lw: 0.6, color: NAVY }); g.ctext("R", x + 46, yy + 15, { size: 4.6 });
  g.text("TEAM", x + 54, yy + 13, { size: 4.6 });
}

function indoorApproval(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, w, 10, HEAD); g.ctext("APPROVAL", x + w / 2, y + 5, { size: 6, bold: true });
  let yy = y + 10;
  const cw = [58, 96, 30, w - 58 - 96 - 30];
  const heads = ["Referee", "Name", "Level", "Signature"];
  let cx = x;
  const colX = cw.map(v => { const a = cx; cx += v; return a; });
  for (let i = 0; i < 4; i++) { g.rect(colX[i], yy, cw[i], 8, { fill: HEAD }); g.ctext(heads[i], colX[i] + cw[i] / 2, yy + 4, { size: 4, bold: true }); }
  yy += 8;
  const rh = 9.6;
  for (const [role, name, level, sig] of IND.officials) {
    g.rect(colX[0], yy, cw[0], rh); g.text(role, colX[0] + 2, yy + 3, { size: 4.2 });
    g.rect(colX[1], yy, cw[1], rh); g.text(name, colX[1] + 2, yy + 3, { size: 4.4, color: INK });
    g.rect(colX[2], yy, cw[2], rh); g.ctext(level, colX[2] + cw[2] / 2, yy + rh / 2, { size: 4.4, color: INK });
    g.rect(colX[3], yy, cw[3], rh);
    if (sig) g.squiggle(colX[3] + 6, yy + 1, cw[3] - 14, rh - 2, sig * 31);
    yy += rh;
  }
  g.rect(x, yy, 58, 11); g.text("Line judges", x + 2, yy + 3.6, { size: 4.2 });
  const ljw = (w - 58) / 4;
  for (let i = 0; i < 4; i++) {
    g.rect(x + 58 + i * ljw, yy, ljw, 11);
    g.text(String(i + 1), x + 60 + i * ljw, yy + 1.6, { size: 3.4 });
  }
  yy += 11;
  const capH = y + h - yy;
  g.rect(x, yy, 58, capH); g.text("Team captains", x + 2, yy + 4.5, { size: 4.2 });
  const tcw = (w - 58) / 2;
  for (let i = 0; i < 2; i++) {
    g.rect(x + 58 + i * tcw, yy, tcw, capH);
    g.text(i === 0 ? "L" : "R", x + 61 + i * tcw, yy + 1.6, { size: 4, bold: true });
    g.squiggle(x + 70 + i * tcw, yy + 1, tcw - 20, capH - 3, 91 + i * 17);
  }
}

function renderIndoor(path) {
  const doc = new PDFDocument({ size: [841.89, 595.28], margin: 0 });
  doc.pipe(fs.createWriteStream(path));
  const g = new G(doc);
  const W = 841.89, H = 595.28;
  g.watermark(W, H, "PREVIEW — MOCK DATA");

  // header
  g.rect(12, 12, 818, 52, { lw: 1 });
  g.rect(740, 12, 90, 52, { lw: 0.8 });
  g.ctext("FIVB", 785, 30, { size: 13, bold: true });
  g.ctext("OFFICIAL E-SCORESHEET", 785, 43, { size: 4 });
  g.ctext("spec/21 preview build", 785, 50, { size: 3.6, color: DIM });
  g.text("Competition:", 16, 16, { size: 5 }); g.text(IND.comp, 48, 15.4, { size: 6, bold: true, color: INK });
  g.text("Pool/Phase:", 330, 16, { size: 5 }); g.text(IND.phase, 360, 15.4, { size: 6, bold: true, color: INK });
  g.line(12, 25, 740, 25);
  g.text("City:", 16, 29, { size: 5 }); g.text(IND.city, 30, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Country:", 130, 29, { size: 5 }); g.text(IND.country, 152, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Match No.:", 280, 29, { size: 5 }); g.text(IND.matchNo, 308, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Date:", 350, 29, { size: 5 }); g.text(IND.date, 365, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Time:", 440, 29, { size: 5 }); g.text(IND.time, 456, 28.4, { size: 5.6, bold: true, color: INK });
  g.text("Hall:", 500, 29, { size: 5 }); g.text(IND.hall, 513, 28.4, { size: 5.6, bold: true, color: INK });
  g.line(12, 38, 740, 38);
  g.text("Division:", 16, 43, { size: 5 });
  const dv = [["Male", false], ["Female", true], ["Mixed", false]];
  let dx = 40;
  for (const [lab, ck] of dv) { g.text(lab, dx, 43, { size: 5 }); g.checkbox(dx + 17 + (lab.length > 4 ? 4 : 0), 41.5, 5.5, ck); dx += 46; }
  g.text("Category:", 190, 43, { size: 5 });
  const cats = [["Senior", true], ["Junior", false], ["Youth", false], ["Kid", false]];
  dx = 218;
  for (const [lab, ck] of cats) { g.text(lab, dx, 43, { size: 5 }); g.checkbox(dx + 17, 41.5, 5.5, ck); dx += 44; }
  // teams banner
  g.circle(420, 55, 6, { lw: 0.8, color: NAVY }); g.ctext("R", 420, 55, { size: 6, bold: true, color: INK });
  g.text("Türkiye", 432, 51.6, { size: 8, bold: true, color: INK });
  g.ctext("TEAMS", 510, 52, { size: 5, bold: true }); g.ctext("vs", 510, 58, { size: 5 });
  g.circle(545, 55, 6, { lw: 0.8, color: NAVY }); g.ctext("L", 545, 55, { size: 6, bold: true, color: INK });
  g.text("Brazil", 557, 51.6, { size: 8, bold: true, color: INK });

  // set panels
  indoorSetPanel(g, 12, 68, 404, 122, IND.sets[0]);
  indoorSetPanel(g, 424, 68, 406, 122, IND.sets[1]);
  indoorSetPanel(g, 12, 194, 404, 122, IND.sets[2]);
  indoorSetPanel(g, 424, 194, 406, 122, IND.sets[3]);
  indoorSet5Panel(g, 12, 320, 404, 122);
  indoorResults(g, 424, 320, 200, 263, IND.results);
  indoorTeams(g, 632, 320, 198, 263);
  indoorSanctions(g, 12, 446, 130, 137);
  // remarks
  g.rect(146, 446, 274, 30, { lw: 0.9 });
  g.fillRect(146, 446, 274, 9, HEAD); g.ctext("REMARKS", 283, 450.5, { size: 5, bold: true });
  g.text(IND.remarks, 150, 459, { size: 5.4, color: INK });
  indoorApproval(g, 146, 479, 274, 104);
  g.footer(W, H, "PREVIEW · spec/21 prototype rendered with pdfkit from mock data (mirrors VNL 2026 Final reference sheet) · not an official record · volleyball-eight.vercel.app");
  doc.end();
  return new Promise(res => doc.on("end", res));
}

/* ============================ BEACH ============================ */

const BEA = {
  comp: "FIVB Beach Volleyball World Championships",
  matchNo: "108", site: "", beach: "", court: "CC", date: "23/11/2025", gender: "F",
  phase: "Main Draw", round: "Final 1st Place",
  A: { name: "Tina/Anastasija", country: "LAT", p1: "GRAUDINA Tina", p2: "SAMOILOVA Anastasija", captain: 1, star: 2, coach: "WOOD RODRIGUEZ Daniel Luis" },
  B: { name: "Nuss/Brasher", country: "USA", p1: "NUSS Kristen", p2: "BRASHER Taryn", captain: 1, star: 1, coach: "" },
  sets: [
    { n: 1, start: "20:13:39", end: "20:30:00", cadence: 7,
      top: { team: "B", orders: [["I", 1], ["III", 2]], rows: [[0, 4, 6, 8, 10, { v: 15, c: 1 }], [3, 5, 7, 9, 14]], points: 15, to: "6:11" },
      bot: { team: "A", orders: [["II", 2], ["IV", 1]], rows: [[1, 7, 11, 13, 17, { v: 21, c: 1 }], [6, 8, 12, 15, 20]], points: 21, to: "17:13" },
      switches: [{ a: 4, b: 3 }, { a: 8, b: 6 }, { a: 13, b: 8, tto: true }, { a: 17, b: 11 }, { a: 20, b: 15 }] },
    { n: 2, start: "20:31:42", end: "20:48:00", cadence: 7,
      top: { team: "A", orders: [["I", 2], ["III", 1]], rows: [[0, 2, 6, 8, 11, 13, { v: 15, c: 1 }], [1, 5, 7, 9, 12, 14]], points: 15, to: "12:15" },
      bot: { team: "B", orders: [["II", 1], ["IV", 2]], rows: [[2, 4, 8, 11, 13, 18, { v: 21, c: 1 }], [3, 7, 9, 12, 15, 20]], points: 21, to: null },
      switches: [{ a: 3, b: 4 }, { a: 6, b: 8 }, { a: 9, b: 12, tto: true }, { a: 13, b: 15 }, { a: 15, b: 20 }] },
    { n: 3, start: "20:49:29", end: "21:00:00", cadence: 5,
      top: { team: "A", orders: [["I", 2], ["III", 1]], rows: [[0, 3, 7, 9, 12, { v: 15, c: 1 }], [1, 4, 8, 10, 13]], points: 15, to: null },
      bot: { team: "B", orders: [["II", 1], ["IV", 2]], rows: [[1, 3, 6, 8, 10], [2, 5, 7, 9, { v: 11, c: 1 }]], points: 11, to: null },
      switches: [{ a: 3, b: 2 }, { a: 5, b: 5 }, { a: 8, b: 7 }, { a: 11, b: 9 }, { a: 14, b: 11 }] },
  ],
  results: {
    rows: [
      { at: 1, aw: 1, ap: 21, set: "Set 1", dur: "(16:20)", bp: 15, bw: 0, bt: 1 },
      { at: 1, aw: 0, ap: 15, set: "Set 2", dur: "(16:17)", bp: 21, bw: 1, bt: 0 },
      { at: 0, aw: 1, ap: 15, set: "Set 3", dur: "(10:30)", bp: 11, bw: 0, bt: 0 },
    ],
    totals: { at: 2, aw: 2, ap: 51, dur: "(43:07)", bp: 47, bw: 1, bt: 1 },
    startT: "20:13:39", endT: "21:00:00", total: "(00:46:20)", winner: "Tina/Anastasija", country: "LAT", score: "2:1",
  },
  officials: [
    ["First referee", "Amantino G.", "BRA", 21], ["Second referee", "Papadogoulas C.", "GRE", null],
    ["Scorer", "Dundas W.", "AU", 22], ["Assistant scorer", "Quan K.", "AU", 23],
  ],
  lineJudges: ["Wei D.", "Searle D.", "", ""],
  remarks: "Total match duration adjustment for Video challenge: 00:00:24.",
  coinToss: { set1: "A", set3: "B" },
};

function beachTeamLeftBlock(g, x, y, w, t, team, mirror) {
  // rows: header 9, order rows 12/12, coach 10, TO+delay 26, team-points 15  => 84
  const teamObj = BEA[t.team];
  const rows = [];
  const headerRow = (yy) => {
    const cw = [26, 15, 23, 23.5, 23.5, 23.5, 23.5];
    const labels = ["Service order", "Player No.", "Formal warning", "Pen.", "Pen.", "Exp.", "Disq."];
    let cx = x;
    for (let i = 0; i < 7; i++) {
      g.rect(cx, yy, cw[i], 9, { fill: HEAD });
      g.ctext(labels[i], cx + cw[i] / 2, yy + 4.5, { size: i < 3 ? 2.9 : 3.6 });
      cx += cw[i];
    }
    g.text("Misconduct sanctions", x + 64, yy - 4.6, { size: 3.4 });
  };
  const orderRow = (yy, ord, no) => {
    const cw = [26, 15, 23, 23.5, 23.5, 23.5, 23.5];
    let cx = x;
    for (let i = 0; i < 7; i++) { g.rect(cx, yy, cw[i], 12); cx += cw[i]; }
    g.ctext(ord, x + 13, yy + 6, { size: 6, bold: true });
    g.ctext(no, x + 33.5, yy + 6, { size: 7, bold: true, color: INK });
  };
  const coachRow = (yy) => {
    const cw = [26, 15, 23, 23.5, 23.5, 23.5, 23.5];
    let cx = x;
    for (let i = 0; i < 7; i++) { g.rect(cx, yy, cw[i], 10); cx += cw[i]; }
    g.ctext("C", x + 13, yy + 5, { size: 5.5, bold: true });
    g.ctext("Coach", x + 33.5, yy + 5, { size: 3.6 });
  };
  const toDelayRow = (yy) => {
    g.rect(x, yy, 41, 26); g.ctext("Time", x + 20.5, yy + 5, { size: 4.6 }); g.ctext("Out", x + 20.5, yy + 10, { size: 4.6 });
    if (t.to) g.ctext(t.to, x + 20.5, yy + 19, { size: 6, bold: true, color: INK });
    g.rect(x + 41, yy, w - 41, 8, { fill: HEAD }); g.ctext("Delay sanctions", x + 41 + (w - 41) / 2, yy + 4, { size: 3.8 });
    const dl = ["Warn.", "Pen.", "Pen.", "Pen."], dw = (w - 41) / 4;
    for (let i = 0; i < 4; i++) {
      g.rect(x + 41 + i * dw, yy + 8, dw, 8, { fill: HEAD });
      g.ctext(dl[i], x + 41 + i * dw + dw / 2, yy + 12, { size: 3.6 });
      g.rect(x + 41 + i * dw, yy + 16, dw, 10);
    }
  };
  const teamPointsRow = (yy) => {
    g.rect(x, yy, w, 16, { fill: HEAD });
    g.text("TEAM – POINTS", x + 2, yy + 2, { size: 3.6 });
    g.text("A or B", x + 44, yy + 1.6, { size: 2.8 });
    g.circle(x + 50, yy + 9.5, 4.8, { lw: 0.7, color: NAVY });
    g.ctext(t.team, x + 50, yy + 9.5, { size: 5.5, bold: true, color: INK });
    g.text(teamObj.country, x + 62, yy + 6, { size: 7, bold: true, color: INK });
  };
  // stack order depends on mirror
  if (!mirror) {
    headerRow(y + 5); orderRow(y + 14, t.orders[0][0], t.orders[0][1]); orderRow(y + 27, t.orders[1][0], t.orders[1][1]);
    coachRow(y + 40); toDelayRow(y + 53); teamPointsRow(y + 82);
  } else {
    teamPointsRow(y); toDelayRow(y + 19); coachRow(y + 48); orderRow(y + 59, t.orders[0][0], t.orders[0][1]); orderRow(y + 72, t.orders[1][0], t.orders[1][1]); headerRow(y + 87);
  }
}

function beachServiceRow(g, x, y, w, h, values) {
  const n = 21, cw = w / n;
  for (let i = 0; i < n; i++) {
    g.rect(x + i * cw, y, cw, h);
    g.text(String(i + 1), x + i * cw + 1, y + 0.8, { size: 3, color: DIM });
    const v = values[i];
    if (v == null) continue;
    const val = typeof v === "object" ? v.v : v;
    g.ctext(val, x + i * cw + cw / 2, y + h / 2 + 1, { size: 6.4, bold: true, color: INK });
    if (typeof v === "object" && v.c) g.ellipse(x + i * cw + cw / 2, y + h / 2 + 1, cw * 0.34, h * 0.36);
  }
}

function beachLadder(g, x, y, w, h, points) {
  const n = 44, cw = w / n;
  g.rect(x, y, w, h);
  for (let i = 1; i <= n; i++) {
    const cx = x + (i - 1) * cw;
    g.ctext(i, cx + cw / 2, y + h / 2, { size: 4.6, color: DIM });
    if (i <= points) {
      g.slash(cx, y + 1, cw, h - 2, { lw: 0.6 });
      if (i === points) g.ellipse(cx + cw / 2, y + h / 2, cw * 0.45, h * 0.4);
    }
  }
  if (points < n) g.line(x + points * cw + 1, y + h / 2, x + w - 1, y + h / 2, { lw: 0.7, color: INK });
}

function beachSetPanel(g, x, y, w, h, set) {
  g.rect(x, y, w, h, { lw: 1 });
  const railW = 56, leftW = 158;
  const cx0 = x + leftW + 6, cw = w - leftW - railW - 16;
  // title row
  g.rect(cx0 + cw / 2 - 30, y + 4, 60, 14);
  g.ctext(`Set ${set.n}`, cx0 + cw / 2, y + 11, { size: 7.5, bold: true });
  g.text(`Start time: ${set.start}`, cx0 + cw - 100, y + 7, { size: 6.5, bold: true, color: INK });
  // top team
  beachTeamLeftBlock(g, x + 3, y + 4, leftW, set.top, set.top, false);
  beachServiceRow(g, cx0, y + 24, cw, 19, set.top.rows[0]);
  beachServiceRow(g, cx0, y + 45, cw, 19, set.top.rows[1]);
  beachLadder(g, cx0, y + 84, cw, 16, set.top.points);
  // bottom team
  beachLadder(g, cx0, y + 128, cw, 16, set.bot.points);
  beachServiceRow(g, cx0, y + 158, cw, 19, set.bot.rows[0]);
  beachServiceRow(g, cx0, y + 179, cw, 19, set.bot.rows[1]);
  beachTeamLeftBlock(g, x + 3, y + 128, leftW, set.bot, set.bot, true);
  g.text(`End time: ${set.end}`, cx0 + cw - 100, y + h - 14, { size: 6.5, bold: true, color: INK });
  // switch rail
  const rx = x + w - railW - 4, ry = y + 4, rh = h - 8;
  g.rect(rx, ry, railW, 16, { fill: HEAD });
  g.ctext("Court switch", rx + railW / 2, ry + 5, { size: 4.4, bold: true });
  g.ctext("A : B", rx + railW / 2, ry + 11, { size: 4.4, bold: true });
  const rows = 8, rrh = (rh - 16) / rows;
  for (let i = 0; i < rows; i++) {
    const cy = ry + 16 + i * rrh;
    g.rect(rx, cy, railW, rrh);
    const s = set.switches[i];
    if (s) {
      g.ctext(`${s.a}:${s.b}`, rx + railW / 2, cy + rrh / 2, { size: 6, bold: true, color: INK });
      if (s.tto) {
        g.rect(rx + 1.5, cy + 1.5, railW - 3, rrh - 3, { lw: 1.1, color: INK });
        g.text("TTO", rx + railW - 13.5, cy + rrh - 6.5, { size: 3.6, bold: true, color: INK });
      }
    } else {
      g.xmark(rx, cy, railW, rrh, { lw: 0.5 });
    }
  }
}

function beachHeader(g, pageW, small) {
  g.text("BEACH VOLLEYBALL INTERNATIONAL E-SCORESHEET", 14, 14, { size: small ? 10 : 14, bold: true });
  g.text("RPS – 2 out of 3 sets", small ? 300 : 400, small ? 17 : 19, { size: 6, bold: true });
  g.rect(pageW - 130, 12, 116, 16);
  g.ctext("VB E-SCORE (PREVIEW)", pageW - 72, 20, { size: 5.5, bold: true });
  g.text(`Competition: `, 14, small ? 28 : 34, { size: 5.5 });
  g.text(BEA.comp, 46, small ? 27.4 : 33.4, { size: 6, bold: true, color: INK });
  const y2 = small ? 37 : 44;
  const items = [["Match No.:", BEA.matchNo, 14], ["Site:", BEA.site, 90], ["Beach:", BEA.beach, 140], ["Court:", BEA.court, 200], ["Date:", BEA.date, 260], ["Gender:", BEA.gender, 350], ["Phase:", BEA.phase, 410], ["Round:", BEA.round, 500]];
  for (const [lab, val, ix] of items) {
    g.text(lab, ix, y2, { size: 5.5 });
    g.text(val, ix + lab.length * 2.4 + 4, y2 - 0.4, { size: 6, bold: true, color: INK });
  }
  return y2 + 10;
}

function beachTeamsBanner(g, y) {
  g.text("A or B", 16, y + 1, { size: 3.4 });
  g.circle(24, y + 12, 6.5, { lw: 0.9, color: NAVY }); g.ctext("A", 24, y + 12, { size: 7, bold: true, color: INK });
  g.ctext(BEA.A.name, 200, y + 12, { size: 9, bold: true, color: INK });
  g.text("Country", 360, y + 4, { size: 4.4 }); g.ctext(BEA.A.country, 370, y + 14, { size: 7, bold: true, color: INK });
  g.ctext("TEAMS", 420, y + 8, { size: 6, bold: true }); g.ctext("vs", 420, y + 16, { size: 6 });
  g.text("A or B", 446, y + 1, { size: 3.4 });
  g.circle(454, y + 12, 6.5, { lw: 0.9, color: NAVY }); g.ctext("B", 454, y + 12, { size: 7, bold: true, color: INK });
  g.ctext(BEA.B.name, 620, y + 12, { size: 9, bold: true, color: INK });
  g.text("Country", 790, y + 4, { size: 4.4 }); g.ctext(BEA.B.country, 800, y + 14, { size: 7, bold: true, color: INK });
  return y + 26;
}

function beachTeamsBlock(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, 12, h, HEAD);
  g.d.save().rotate(-90, { origin: [x + 6, y + h / 2] });
  g.ctext("TEAMS", x + 6, y + h / 2, { size: 6, bold: true });
  g.d.restore();
  const half = (w - 12) / 2;
  for (const [i, T] of [BEA.A, BEA.B].entries()) {
    const tx = x + 12 + i * half;
    g.rect(tx, y, half, 10, { fill: HEAD });
    g.ctext(`${T.country}   (${i === 0 ? "A" : "B"})`, tx + half / 2, y + 5, { size: 5.5, bold: true });
    let yy = y + 10;
    g.rect(tx, yy, 14, 8, { fill: HEAD }); g.ctext("No.", tx + 7, yy + 4, { size: 3.8 });
    g.rect(tx + 14, yy, half - 14, 8, { fill: HEAD }); g.text("Name", tx + 17, yy + 2.2, { size: 3.8 });
    yy += 8;
    const rows = [[1, T.p1], [2, T.p2], ["C", T.coach]];
    for (const [no, name] of rows) {
      g.rect(tx, yy, 14, 11); g.rect(tx + 14, yy, half - 14, 11);
      g.ctext(no, tx + 7, yy + 5.5, { size: 5.5, bold: true, color: INK });
      if (no === T.captain) g.ellipse(tx + 7, yy + 5.5, 5, 4, { lw: 0.6 });
      if (no === T.star) g.text("*", tx + 11.4, yy + 2.4, { size: 6.5, bold: true, color: INK });
      g.text(name, tx + 17, yy + 3, { size: 5, bold: !!name, color: INK });
      yy += 11;
    }
    g.rect(tx, yy, half, 16);
    g.text("Captain's pre-match signature:", tx + 2, yy + 2, { size: 3.6 });
    g.squiggle(tx + 20, yy + 4, half - 40, 10, 61 + i * 29);
    yy += 16;
    g.rect(tx, yy, half, 16);
    g.text("Coach's pre-match signature:", tx + 2, yy + 2, { size: 3.6 });
    if (T.coach) g.squiggle(tx + 20, yy + 4, half - 40, 10, 77 + i * 31);
    yy += 16;
  }
}

function beachResults(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, 12, h, HEAD);
  g.d.save().rotate(-90, { origin: [x + 6, y + h / 2] });
  g.ctext("RESULTS", x + 6, y + h / 2, { size: 6, bold: true });
  g.d.restore();
  const bx = x + 12, bw = w - 12;
  const heads = ["Timeouts", "Wins", "Points", "Set duration", "Points", "Wins", "Timeouts"];
  const cw = [bw * 0.12, bw * 0.1, bw * 0.12, bw * 0.32, bw * 0.12, bw * 0.1, bw * 0.12];
  let cx = bx;
  const colX = cw.map(v => { const a = cx; cx += v; return a; });
  for (let i = 0; i < 7; i++) { g.rect(colX[i], y, cw[i], 9, { fill: HEAD }); g.ctext(heads[i], colX[i] + cw[i] / 2, y + 4.5, { size: 3.8, bold: true }); }
  let yy = y + 9;
  for (const r of BEA.results.rows) {
    const vals = [r.at, r.aw, r.ap, `${r.set}  ${r.dur}`, r.bp, r.bw, r.bt];
    for (let i = 0; i < 7; i++) { g.rect(colX[i], yy, cw[i], 10); g.ctext(vals[i], colX[i] + cw[i] / 2, yy + 5, { size: 5, color: INK, bold: i === 3 }); }
    yy += 10;
  }
  const t = BEA.results.totals;
  const tvals = [t.at, t.aw, t.ap, `Total  ${t.dur}`, t.bp, t.bw, t.bt];
  for (let i = 0; i < 7; i++) { g.rect(colX[i], yy, cw[i], 10, { fill: HEAD }); g.ctext(tvals[i], colX[i] + cw[i] / 2, yy + 5, { size: 5, bold: true, color: INK }); }
  yy += 10;
  g.rect(bx, yy, bw * 0.25, 14); g.ctext("Match start time", bx + bw * 0.125, yy + 3.6, { size: 3.6 });
  g.ctext(BEA.results.startT, bx + bw * 0.125, yy + 9.6, { size: 5.4, bold: true, color: INK });
  g.rect(bx + bw * 0.25, yy, bw * 0.5, 14); g.ctext("Total match duration", bx + bw * 0.5, yy + 3.6, { size: 3.6 });
  g.ctext(BEA.results.total, bx + bw * 0.5, yy + 9.6, { size: 5.4, bold: true, color: INK });
  g.rect(bx + bw * 0.75, yy, bw * 0.25, 14); g.ctext("Match ending time", bx + bw * 0.875, yy + 3.6, { size: 3.6 });
  g.ctext(BEA.results.endT, bx + bw * 0.875, yy + 9.6, { size: 5.4, bold: true, color: INK });
  yy += 14;
  g.rect(bx, yy, bw, y + h - yy);
  g.text("Winning team:", bx + 3, yy + 4, { size: 5 });
  g.text(`${BEA.results.winner}   ${BEA.results.country}   ${BEA.results.score}`, bx + 42, yy + 3.4, { size: 6.5, bold: true, color: INK });
}

function beachApproval(g, x, y, w, h) {
  g.rect(x, y, w, h, { lw: 0.9 });
  g.fillRect(x, y, 12, h, HEAD);
  g.d.save().rotate(-90, { origin: [x + 6, y + h / 2] });
  g.ctext("APPROVAL", x + 6, y + h / 2, { size: 6, bold: true });
  g.d.restore();
  const bx = x + 12, bw = w - 12;
  const cw = [bw * 0.22, bw * 0.34, bw * 0.14, bw * 0.3];
  let cx = bx;
  const colX = cw.map(v => { const a = cx; cx += v; return a; });
  const heads = ["Officials", "Name", "Country", "Signature"];
  for (let i = 0; i < 4; i++) { g.rect(colX[i], y, cw[i], 8, { fill: HEAD }); g.ctext(heads[i], colX[i] + cw[i] / 2, y + 4, { size: 4, bold: true }); }
  let yy = y + 8;
  for (const [role, name, ctry, sig] of BEA.officials) {
    g.rect(colX[0], yy, cw[0], 10); g.text(role, colX[0] + 2, yy + 3, { size: 4.2 });
    g.rect(colX[1], yy, cw[1], 10); g.text(name, colX[1] + 2, yy + 2.8, { size: 4.6, color: INK });
    g.rect(colX[2], yy, cw[2], 10); g.ctext(ctry, colX[2] + cw[2] / 2, yy + 5, { size: 4.6, color: INK });
    g.rect(colX[3], yy, cw[3], 10);
    if (sig) g.squiggle(colX[3] + 8, yy + 1, cw[3] - 18, 8, sig * 37);
    yy += 10;
  }
  g.rect(bx, yy, cw[0], 16); g.text("Line judges", bx + 2, yy + 5.5, { size: 4.4 });
  const ljw = (bw - cw[0]) / 2;
  for (let i = 0; i < 4; i++) {
    const lx = bx + cw[0] + (i % 2) * ljw, ly = yy + Math.floor(i / 2) * 8;
    g.rect(lx, ly, ljw, 8);
    g.text(`${i + 1}  ${BEA.lineJudges[i] || ""}`, lx + 2, ly + 2, { size: 4.2, color: INK });
  }
  yy += 16;
  const capH = y + h - yy;
  const half = bw / 2;
  for (let i = 0; i < 2; i++) {
    g.rect(bx + i * half, yy, half, capH);
    g.text("Captain post-match signature:", bx + i * half + 2, yy + 2, { size: 3.8 });
    g.squiggle(bx + i * half + 30, yy + 4, half - 60, capH - 8, 111 + i * 41);
  }
}

function renderBeach(path) {
  const doc = new PDFDocument({ size: [841.89, 595.28], margin: 0 });
  doc.pipe(fs.createWriteStream(path));
  const g = new G(doc);
  const W = 841.89, H = 595.28;
  // page 1
  g.watermark(W, H, "PREVIEW — MOCK DATA");
  let y = beachHeader(g, W, false);
  y = beachTeamsBanner(g, y);
  beachSetPanel(g, 12, y + 2, 818, 226, BEA.sets[0]);
  beachSetPanel(g, 12, y + 236, 818, 226, BEA.sets[1]);
  g.footer(W, H, "PREVIEW · spec/21 prototype rendered with pdfkit from mock data (mirrors Beach WCh 2025 Final reference sheet) · not an official record · page 1/2");
  // page 2
  doc.addPage({ size: [841.89, 595.28], margin: 0 });
  g.watermark(W, H, "PREVIEW — MOCK DATA");
  let y2 = beachHeader(g, W, true);
  beachSetPanel(g, 12, y2, 818, 226, BEA.sets[2]);
  const by = y2 + 232;
  const bottomH = H - by - 14;
  // left column: TEAMS / RESULTS / APPROVAL stacked
  beachTeamsBlock(g, 12, by, 462, 92);
  beachResults(g, 12, by + 95, 462, 86);
  beachApproval(g, 12, by + 184, 462, bottomH - 184);
  // right column: tall REMARKS + coin toss / improper request
  const rx = 480, rw = 350;
  const remH = bottomH - 30;
  g.rect(rx, by, rw, remH, { lw: 0.9 });
  g.text("Remarks:", rx + 4, by + 4, { size: 6.5, bold: true });
  g.text("Additional information attached", rx + rw - 105, by + 5, { size: 4 });
  g.rect(rx + rw - 16, by + 2, 11, 11); g.xmark(rx + rw - 16, by + 2, 11, 11);
  g.text(BEA.remarks, rx + 4, by + 18, { size: 5.4, color: INK });
  const cy = by + remH + 3;
  g.rect(rx, cy, rw, bottomH - remH - 3, { lw: 0.9 });
  g.text("Winner of Coin Toss:", rx + 4, cy + 9, { size: 6, bold: true });
  g.text("Set 1", rx + 78, cy + 9, { size: 5.5 });
  g.circle(rx + 98, cy + 11.5, 5.5, { lw: 0.7, color: NAVY }); g.ctext(BEA.coinToss.set1, rx + 98, cy + 11.5, { size: 5.5, bold: true, color: INK });
  g.text("Set 3", rx + 112, cy + 9, { size: 5.5 });
  g.circle(rx + 132, cy + 11.5, 5.5, { lw: 0.7, color: NAVY }); g.ctext(BEA.coinToss.set3, rx + 132, cy + 11.5, { size: 5.5, bold: true, color: INK });
  g.text("Improper request:", rx + 200, cy + 9, { size: 6, bold: true });
  g.circle(rx + 268, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  g.circle(rx + 283, cy + 11.5, 5.5, { lw: 0.7, color: NAVY });
  g.footer(W, H, "PREVIEW · spec/21 prototype rendered with pdfkit from mock data · not an official record · page 2/2");
  doc.end();
  return new Promise(res => doc.on("end", res));
}

(async () => {
  await renderIndoor("/home/fivb1/PREVIEW Indoor Official E-Scoresheet (mock).pdf");
  await renderBeach("/home/fivb1/PREVIEW Beach Official E-Scoresheet (mock).pdf");
  console.log("done");
})();
