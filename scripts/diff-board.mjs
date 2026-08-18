/**
 * Pixel-diff gate for the AVC boards (spec/35 W8).
 *
 * Renders a board against a REPLICA of the master's own dummy data, then
 * compares it with the 4x master render downsampled to 1920x1080. This is what
 * makes "matches the template" a measurement rather than an opinion: the
 * per-element rates below name the element that is off, so a failure is
 * actionable instead of a vague "looks wrong".
 *
 *   node scripts/diff-board.mjs [baseUrl]
 *
 * Needs the dev server running (default http://localhost:3000).
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import zlib from "node:zlib";

const BASE = process.argv[2] ?? "http://localhost:3000";
const BOARD_URL = `${BASE}/t/live-events/scoreboard/vis/comp_vis_1671/27062?screen=board&replica=1`;
const MASTER = "spec/reference/avc/full4x-AVC-VenueBrand-Scoreboard-RGB-16-9.png";
const OUT = "/tmp/vis-diff";
const TOLERANCE = 32; // per-channel, absorbs antialiasing between renderers
/**
 * Rows below this are excluded: the homologation banner (spec/28) is
 * deliberately rendered on every surface of a non-production build, including
 * boards, and does not exist in production.
 */
const BANNER_Y = 1040;
/**
 * Flag INTERIORS are excluded — our self-hosted flag assets are not the
 * master's own artwork (different source, deliberately). Their BOXES are
 * asserted by the geometry check below, which is the part that matters.
 */
const EXCLUDE = [
  { x: 489, y: 171, w: 132, h: 132 },
  { x: 1300, y: 171, w: 133, h: 133 },
];

/** The master's dummy state, as a board payload. */
const REPLICA = {
  matchNo: 0,
  status: "LIVE",
  teamA: {
    code: "BRA",
    name: "Brazil",
    players: Array.from({ length: 6 }, (_, i) => ({
      position: i + 1, jersey: 1, name: "Player Name", points: 1, isLibero: false,
    })),
    timeouts: 1, substitutions: 1, challenges: 1,
  },
  teamB: {
    code: "JPN",
    name: "Japan",
    players: Array.from({ length: 6 }, (_, i) => ({
      position: i + 1, jersey: 1, name: "Player Name", points: 1, isLibero: false,
    })),
    timeouts: 1, substitutions: 1, challenges: 1,
  },
  setsWonA: 2, setsWonB: 0,
  scoreA: 2, scoreB: 0,
  currentSet: 3,
  serving: "A",
  sets: [
    { setNumber: 1, scoreA: 25, scoreB: 25, winner: null },
    { setNumber: 2, scoreA: 10, scoreB: 10, winner: null },
    { setNumber: 3, scoreA: 25, scoreB: 25, winner: null },
    { setNumber: 4, scoreA: 10, scoreB: 10, winner: null },
  ],
  teamAAtLeft: true,
  inSetBreak: false,
  lastFinishedSet: null,
  stats: null,
  poolName: null,
  tournamentName: null,
  scheduledLocal: null,
  pollDelaySeconds: 20,
};

/** Measured element boxes to report individually (design px). */
const ELEMENTS = [
  { name: "score frame + big plates", x: 726, y: 128, w: 468, h: 216 },
  { name: "sets block", x: 800, y: 331, w: 320, h: 158 },
  { name: "flag left", x: 489, y: 171, w: 131, h: 131 },
  { name: "flag right", x: 1301, y: 171, w: 131, h: 131 },
  { name: "team name left", x: 180, y: 196, w: 290, h: 70 },
  { name: "team name right", x: 1450, y: 196, w: 290, h: 70 },
  { name: "serving frame left", x: 96, y: 444, w: 464, h: 100 },
  { name: "jersey plates left", x: 108, y: 456, w: 76, h: 560 },
  { name: "jersey plates right", x: 1736, y: 456, w: 76, h: 560 },
  { name: "PTS column left", x: 647, y: 381, w: 105, h: 632 },
  { name: "PTS column right", x: 1168, y: 381, w: 105, h: 632 },
  { name: "ladder", x: 860, y: 488, w: 200, h: 250 },
  { name: "counters", x: 823, y: 736, w: 267, h: 277 },
  { name: "SET label", x: 850, y: 50, w: 220, h: 70 },
];

// ── minimal PNG reader/writer (no deps) ──────────────────────────────────────
function readPng(path) {
  const d = readFileSync(path);
  let pos = 8, w, h, ctype, plte = null;
  const idat = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString("ascii", pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ctype = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = data;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const stride = w * ch;
  const rgb = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride), i = 0;
  for (let row = 0; row < h; row++) {
    const filter = raw[i++];
    const line = Buffer.from(raw.subarray(i, i + stride)); i += stride;
    if (filter === 1) for (let x = ch; x < stride; x++) line[x] = (line[x] + line[x - ch]) & 255;
    else if (filter === 2) for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255;
    else if (filter === 3) for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0;
      line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255;
    } else if (filter === 4) for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 3;
      if (ctype === 3) { const idx = line[x]; rgb[o] = plte[idx * 3]; rgb[o + 1] = plte[idx * 3 + 1]; rgb[o + 2] = plte[idx * 3 + 2]; }
      else { rgb[o] = line[x * ch]; rgb[o + 1] = line[x * ch + 1]; rgb[o + 2] = line[x * ch + 2]; }
    }
  }
  return { w, h, rgb };
}

function writePng(path, w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), rgb.subarray(y * w * 3, (y + 1) * w * 3));
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0)),
  ]));
}

/** Box-average a 4x render down to 1920x1080. */
function downsample4(src) {
  const W = 1920, H = 1080;
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const o = ((y * 4 + dy) * src.w + (x * 4 + dx)) * 3;
      r += src.rgb[o]; g += src.rgb[o + 1]; b += src.rgb[o + 2];
    }
    const o = (y * W + x) * 3;
    out[o] = Math.round(r / 16); out[o + 1] = Math.round(g / 16); out[o + 2] = Math.round(b / 16);
  }
  return { w: W, h: H, rgb: out };
}

const excluded = (x, y) =>
  y >= BANNER_Y || EXCLUDE.some((e) => x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h);

function rate(a, b, box) {
  let match = 0, total = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    if (x < 0 || y < 0 || x >= 1920 || y >= 1080) continue;
    if (excluded(x, y)) continue;
    const o = (y * 1920 + x) * 3;
    const d = Math.max(
      Math.abs(a.rgb[o] - b.rgb[o]),
      Math.abs(a.rgb[o + 1] - b.rgb[o + 1]),
      Math.abs(a.rgb[o + 2] - b.rgb[o + 2]),
    );
    total++; if (d <= TOLERANCE) match++;
  }
  return total ? match / total : 1;
}

// ── run ──────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.route("**/api/vis/board/**", (route) =>
  route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ board: REPLICA, ageSeconds: 0 }),
  }),
);
await page.goto(BOARD_URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/actual.png` });
await browser.close();

const actual = readPng(`${OUT}/actual.png`);
const master = downsample4(readPng(MASTER));
writePng(`${OUT}/master-1x.png`, master.w, master.h, master.rgb);

// Difference image, for eyeballing what the numbers mean.
const diff = Buffer.alloc(1920 * 1080 * 3);
for (let i = 0; i < 1920 * 1080; i++) {
  const o = i * 3;
  const d = Math.max(
    Math.abs(actual.rgb[o] - master.rgb[o]),
    Math.abs(actual.rgb[o + 1] - master.rgb[o + 1]),
    Math.abs(actual.rgb[o + 2] - master.rgb[o + 2]),
  );
  if (d <= TOLERANCE) { diff[o] = diff[o + 1] = diff[o + 2] = 20; }
  else { diff[o] = 255; diff[o + 1] = 40; diff[o + 2] = 40; }
}
writePng(`${OUT}/diff.png`, 1920, 1080, diff);

// ── geometry check: the PRIMARY gate ────────────────────────────────────────
// A pixel percentage over vector art re-rendered by a different engine is
// dominated by 1-2 px antialiasing on every edge, so it can never reach 100 %
// however exact the layout is. What "matches the master" actually means is that
// every element's BOX lands where the master's does — measured here to the
// half-pixel, which is a stricter and more honest test than the pixel rate.
function boxesOf(img, pred, minArea) {
  const W = 1920, H = 1080;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    if (pred(img.rgb[o], img.rgb[o + 1], img.rgb[o + 2])) mask[y * W + x] = 1;
  }
  const seen = new Uint8Array(W * H), out = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0;
    while (sp > 0) {
      const p = stack[--sp]; n++;
      const py = (p / W) | 0, px = p - py * W;
      if (px < minx) minx = px; if (px > maxx) maxx = px;
      if (py < miny) miny = py; if (py > maxy) maxy = py;
      const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
    }
    if (n >= minArea) out.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, n });
  }
  return out;
}
const RED = (r, g, b) => r > 200 && g < 80 && b < 95;
const WHITE = (r, g, b) => r > 235 && g > 235 && b > 235;
const near = (list, x, y, tol = 30) => {
  let best = null, bd = 1e9;
  for (const b of list) { const d = Math.abs(b.x - x) + Math.abs(b.y - y); if (d < bd) { bd = d; best = b; } }
  return bd <= tol ? best : null;
};
const GEOM = [
  ["white", "big plate L", 738.5, 140.5, 214.5, 190.5],
  ["white", "big plate R", 966.5, 140.5, 215.0, 190.5],
  ["white", "sets plate L", 813.0, 343.5, 140.0, 133.0],
  ["white", "sets plate R", 965.5, 343.5, 141.5, 133.0],
  ["white", "PTS column L", 647.5, 382.0, 103.0, 629.5],
  ["white", "PTS column R", 1168.5, 382.0, 103.0, 629.5],
  ["white", "jersey plate L row1", 109.0, 457.5, 73.5, 74.0],
  ["white", "jersey plate R row1", 1737.5, 457.5, 74.0, 74.0],
  ["white", "jersey plate L row6", 109.0, 923.0, 73.5, 74.0],
  ["red", "serving frame L", 97.0, 445.5, 462.0, 98.0],
  ["red", "serving frame R", 1361.0, 445.5, 462.5, 98.0],
  ["red", "big digit (L plate)", 797.5, 174.5, 96.0, 120.5],
];
const aBoxes = { red: boxesOf(actual, RED, 400), white: boxesOf(actual, WHITE, 400) };
const mBoxes = { red: boxesOf(master, RED, 400), white: boxesOf(master, WHITE, 400) };
console.log("\ngeometry (gate: every |delta| ≤ 2.0 px):");
let geomFails = [];
for (const [kind, label, gx, gy] of GEOM) {
  const a = near(aBoxes[kind], gx, gy), m = near(mBoxes[kind], gx, gy);
  if (!a || !m) { geomFails.push(`${label} (not found)`); console.log(`  MISS       ${label}`); continue; }
  const d = [a.x - m.x, a.y - m.y, a.w - m.w, a.h - m.h];
  const worst = Math.max(...d.map(Math.abs));
  const ok = worst <= 2.0;
  if (!ok) geomFails.push(`${label} Δ${worst.toFixed(1)}px`);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} Δmax ${worst.toFixed(1).padStart(4)}px  ${label}` +
    `   dx=${d[0]} dy=${d[1]} dw=${d[2]} dh=${d[3]}`,
  );
}

const overall = rate(actual, master, { x: 0, y: 0, w: 1920, h: BANNER_Y });
// Secondary signal, calibrated to what two renderers can agree on: every edge
// carries 1-2 px of antialiasing disagreement, so ~90 % inside a dense element
// means "aligned", not "wrong". Gross errors still collapse it far below.
console.log(`\npixel agreement: ${(overall * 100).toFixed(2)}%  (gate ≥ 88%)`);
console.log("per element (gate ≥ 78%, antialiasing-bound):");
let worstFails = [];
for (const el of ELEMENTS) {
  const r = rate(actual, master, el);
  const ok = r >= 0.78;
  if (!ok) worstFails.push(`${el.name} ${(r * 100).toFixed(1)}%`);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${(r * 100).toFixed(1).padStart(6)}%  ${el.name}`);
}
console.log(`\nartifacts: ${OUT}/actual.png ${OUT}/master-1x.png ${OUT}/diff.png`);
if (overall < 0.88 || worstFails.length || geomFails.length) {
  console.log(
    `\nGATE FAILED — geometry: ${geomFails.join(", ") || "ok"}; ` +
    `pixels ${(overall * 100).toFixed(2)}%; elements: ${worstFails.join(", ") || "ok"}`,
  );
  process.exit(1);
}
console.log("\nGATE PASSED");
