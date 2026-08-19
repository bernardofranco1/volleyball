/**
 * Does every number still sit inside its box? (spec/39)
 *
 * The U-shape rail is 152 design px wide and its boxes were sized for a
 * one-digit score, so "25" ran past the border on every side of every rail. The
 * caps are now chosen for the widest string each box can hold — but that is an
 * arithmetic claim about a font, and the only way to know is to render it and
 * measure.
 *
 * Point it at a running board and it walks every text node, comparing the
 * text's own rectangle with its container's. Exit code 1 on any overflow.
 *
 *   npx next dev -p 3313
 *   node scripts/check-board-fit.mjs http://localhost:3313/board-lab
 */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:3313/board-lab";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
let bad = 0;
for (const q of ["?state=live&sa=8&sb=9", "?state=live&sa=25&sb=25", "?state=final", "?state=live&sa=33&sb=31"]) {
  await p.goto(`${BASE}${q}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  // Every absolutely-positioned box in the rails/band: does its text fit?
  const over = await p.evaluate(() => {
    const out = [];
    const range = document.createRange();
    for (const el of document.querySelectorAll("div,span")) {
      const kids = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!kids.length) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      const dx = Math.max(0, box.left - t.left, t.right - box.right);
      const dy = Math.max(0, box.top - t.top, t.bottom - box.bottom);
      if (dx > 1.5 || dy > 1.5) {
        out.push({ text: el.textContent.trim().slice(0, 12), dx: +dx.toFixed(1), dy: +dy.toFixed(1),
                   w: +box.width.toFixed(0), h: +box.height.toFixed(0) });
      }
    }
    return out;
  });
  console.log(q, over.length ? "OVERFLOW" : "ok");
  for (const o of over) { console.log("   ", JSON.stringify(o)); bad++; }
}
await b.close();
process.exit(bad ? 1 : 0);
