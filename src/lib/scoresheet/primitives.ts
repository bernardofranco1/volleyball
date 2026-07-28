// Drawing primitives shared by the official indoor + beach scoresheet
// renderers (spec/21 Phase C). The visual language of the FIVB sheets:
// navy pre-printed template, light header fills, black "recorded" marks —
// slashes over scored points, circles around final scores, X over dead boxes,
// one straight strike through unused ladder tails.

import type PDFDocument from "pdfkit";
import { liberationRegular } from "./fonts/regular";
import { liberationBold } from "./fonts/bold";

export const NAVY = "#2b3f5c"; // pre-printed template
export const HEAD = "#e8eef7"; // header fills
export const INK = "#101010"; // recorded data
export const DIM = "#6b7686"; // pre-printed ladder numbers

export const PAGE_W = 841.89; // A4 landscape
export const PAGE_H = 595.28;

type Doc = InstanceType<typeof PDFDocument>;

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: string;
  w?: number;
  align?: "left" | "center" | "right";
}

/** Register the embedded Liberation Sans faces (full Unicode — the built-in
 *  Helvetica AFMs are WinAnsi-only and garble names like "Şahin"). */
export function registerSheetFonts(doc: Doc): void {
  doc.registerFont("S", liberationRegular);
  doc.registerFont("SB", liberationBold);
}

export class Sheet {
  constructor(public d: Doc) {}

  rect(x: number, y: number, w: number, h: number, opts: { lw?: number; color?: string; fill?: string | null } = {}) {
    const { lw = 0.6, color = NAVY, fill = null } = opts;
    if (fill) this.d.save().rect(x, y, w, h).fill(fill).restore();
    this.d.save().lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke().restore();
  }

  fillRect(x: number, y: number, w: number, h: number, fill: string) {
    this.d.save().rect(x, y, w, h).fill(fill).restore();
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { lw?: number; color?: string } = {}) {
    const { lw = 0.6, color = NAVY } = opts;
    this.d.save().lineWidth(lw).strokeColor(color).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
  }

  text(s: string | number, x: number, y: number, opts: TextOpts = {}) {
    const { size = 6, bold = false, color = NAVY, w, align = "left" } = opts;
    this.d.font(bold ? "SB" : "S").fontSize(size).fillColor(color);
    this.d.text(String(s), x, y, { width: w, align, lineBreak: !!w });
  }

  /** Text centred on a point. */
  ctext(s: string | number, cx: number, cy: number, opts: TextOpts = {}) {
    const { size = 6, bold = false, color = NAVY } = opts;
    this.d.font(bold ? "SB" : "S").fontSize(size).fillColor(color);
    const tw = this.d.widthOfString(String(s));
    this.d.text(String(s), cx - tw / 2, cy - size * 0.36, { lineBreak: false });
  }

  circle(cx: number, cy: number, r: number, opts: { lw?: number; color?: string } = {}) {
    const { lw = 0.7, color = INK } = opts;
    this.d.save().lineWidth(lw).strokeColor(color).circle(cx, cy, r).stroke().restore();
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, opts: { lw?: number; color?: string } = {}) {
    const { lw = 0.7, color = INK } = opts;
    this.d.save().lineWidth(lw).strokeColor(color).ellipse(cx, cy, rx, ry).stroke().restore();
  }

  /** The scorer's point slash across a ladder cell. */
  slash(x: number, y: number, w: number, h: number, opts: { lw?: number } = {}) {
    this.line(x + w * 0.18, y + h * 0.84, x + w * 0.82, y + h * 0.16, {
      lw: opts.lw ?? 0.6,
      color: INK,
    });
  }

  /** Cross over a dead box (receiving team's round-1 box, unused switch rows). */
  xmark(x: number, y: number, w: number, h: number, opts: { lw?: number } = {}) {
    const lw = opts.lw ?? 0.6;
    this.line(x + w * 0.2, y + h * 0.2, x + w * 0.8, y + h * 0.8, { lw, color: INK });
    this.line(x + w * 0.2, y + h * 0.8, x + w * 0.8, y + h * 0.2, { lw, color: INK });
  }

  checkbox(x: number, y: number, s: number, checked: boolean) {
    this.rect(x, y, s, s, { lw: 0.6 });
    if (checked) this.xmark(x, y, s, s, { lw: 0.8 });
  }

  /** Vertical rotated label used on block rails ("TEAMS", "Set 3", …). */
  vlabel(s: string, cx: number, cy: number, opts: TextOpts = {}) {
    this.d.save().rotate(-90, { origin: [cx, cy] });
    this.ctext(s, cx, cy, opts);
    this.d.restore();
  }

  /** Diagonal watermark for sheets of unfinished matches. */
  watermark(label: string) {
    const d = this.d;
    d.save()
      .rotate(-18, { origin: [PAGE_W / 2, PAGE_H / 2] })
      .font("SB")
      .fontSize(46)
      .fillColor("#8aa0c0")
      .fillOpacity(0.12);
    const tw = d.widthOfString(label);
    d.text(label, PAGE_W / 2 - tw / 2, PAGE_H / 2 - 20, { lineBreak: false });
    d.restore().fillOpacity(1);
  }

  footer(s: string) {
    this.text(s, 12, PAGE_H - 9, { size: 4.4, color: "#8b95a6" });
  }
}

// ── shared mark helpers ──────────────────────────────────────────────────────

/** Horizontal points ladder 1..max: slash scored, circle the final point, one
 *  straight strike through the unused tail. */
export function hLadder(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  max: number,
  points: number,
) {
  const cw = w / max;
  g.rect(x, y, w, h);
  for (let i = 1; i <= max; i++) {
    const cx = x + (i - 1) * cw;
    g.ctext(i, cx + cw / 2, y + h / 2, { size: 4.6, color: DIM });
    if (i <= points) {
      g.slash(cx, y + 1, cw, h - 2);
      if (i === points) g.ellipse(cx + cw / 2, y + h / 2, cw * 0.45, h * 0.4);
    }
  }
  if (points < max)
    g.line(x + points * cw + 1, y + h / 2, x + w - 1, y + h / 2, { lw: 0.7, color: INK });
}

/** Vertical two-column points strip 1..max (indoor panels). */
export function vLadder(
  g: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  max: number,
  points: number,
) {
  const rows = Math.ceil(max / 2);
  const rH = h / rows;
  const cW = w / 2;
  g.rect(x, y, w, h);
  g.line(x + cW, y, x + cW, y + h, { lw: 0.3 });
  for (let n = 1; n <= max; n++) {
    const col = n <= rows ? 0 : 1;
    const row = (n - 1) % rows;
    const cx = x + col * cW;
    const cy = y + row * rH;
    g.ctext(n, cx + cW / 2, cy + rH / 2, { size: 3.4, color: DIM });
    if (n <= points) {
      g.line(cx + cW * 0.32, cy + rH * 0.82, cx + cW * 0.68, cy + rH * 0.18, { lw: 0.45, color: INK });
      if (n === points) g.ellipse(cx + cW / 2, cy + rH / 2, cW * 0.3, rH * 0.6, { lw: 0.6 });
    }
  }
  for (const [start, end, col] of [
    [1, rows, 0],
    [rows + 1, max, 1],
  ] as const) {
    const from = Math.max(points + 1, start);
    if (from > end) continue;
    const cx = x + col * cW + cW / 2;
    const y1 = y + ((from - start) % rows) * rH + 0.6;
    const y2 = y + (end - start + 1) * rH - 0.6;
    g.line(cx, y1, cx, y2, { lw: 0.6, color: INK });
  }
}

// ── formatting helpers ───────────────────────────────────────────────────────

export function hhmm(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function hhmmss(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${hhmm(date)}:${String(date.getUTCSeconds()).padStart(2, "0")}`;
}

/** Whole minutes between two instants, or null. Spans over 10 hours are
 *  treated as unknown — synthetic/imported timestamps, not a real duration. */
export function durationMin(a: Date | string | null, b: Date | string | null): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2) || t2 < t1) return null;
  const min = Math.round((t2 - t1) / 60000);
  return min > 600 ? null : min;
}

export function durationHhMm(a: Date | string | null, b: Date | string | null): string {
  const min = durationMin(a, b);
  if (min == null) return "";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** Team code for the sheet: ISO country when present, else name initials. */
export function teamCode(country: string | null, name: string): string {
  if (country) return country.toUpperCase().slice(0, 3);
  const letters = name.replace(/[^\p{L}]/gu, "").toUpperCase();
  return (letters || "TBD").slice(0, 3);
}
