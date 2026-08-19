/**
 * Strip artwork bled into the counter icons' alpha (spec/37).
 *
 * The three interruption icons were keyed out of the AVC master by hand. The
 * time-out cut took a chevron of the background swirl with it at ~60/255 alpha:
 * 4,740 pixels in a flat plateau, invisible on a light ground and a grey smear
 * on the board's navy — reported from a live screen as "the background image
 * interfering with the time-out icon".
 *
 * Genuine antialiasing on a glyph edge is a thin ramp spread across the whole
 * 1-254 range. Bled artwork is a wide, FLAT plateau. So the fix is a floor:
 * anything below it was never part of the glyph.
 *
 *   node scripts/clean-board-icon-alpha.mjs [--write]
 *
 * Without --write it only reports, so it doubles as the check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/** Alpha floor: the plateau sits at 32-64, real edges keep everything above. */
const FLOOR = 96;
const ICONS = ["icon-timeout", "icon-subs", "icon-challenge"];

function chunks(buf) {
  const out = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    out.push({ type, data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function encode(cs) {
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const { type, data } of cs) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    parts.push(len, body, crc);
  }
  return Buffer.concat(parts);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode an 8-bit RGBA PNG to raw pixels. These assets are all RGBA/8. */
export function readRgba(path) {
  const cs = chunks(readFileSync(path));
  const ihdr = cs.find((c) => c.type === "IHDR").data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const depth = ihdr[8], color = ihdr[9];
  if (depth !== 8 || color !== 6) throw new Error(`${path}: expected 8-bit RGBA`);
  const raw = inflateSync(
    Buffer.concat(cs.filter((c) => c.type === "IDAT").map((c) => c.data)),
  );
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const filter = raw[i++];
    const line = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) line[x] = (line[x] + paeth(a, b, c)) & 255;
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return { w, h, px };
}

function writeRgba(path, { w, h, px }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, encode([
    { type: "IHDR", data: ihdr },
    { type: "IDAT", data: deflateSync(raw, { level: 9 }) },
    { type: "IEND", data: Buffer.alloc(0) },
  ]));
}

const write = process.argv.includes("--write");
for (const name of ICONS) {
  const path = `public/board-art/${name}.png`;
  const img = readRgba(path);
  let cleared = 0;
  for (let i = 3; i < img.px.length; i += 4) {
    const a = img.px[i];
    if (a > 0 && a < FLOOR) { img.px[i] = 0; cleared++; }
  }
  console.log(`${name}: ${cleared} px below alpha ${FLOOR}${write ? " — cleared" : ""}`);
  if (write && cleared) writeRgba(path, img);
}
