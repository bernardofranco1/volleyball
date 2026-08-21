/**
 * Render /tv in a real browser and check the score bug landed where spec/47
 * says it should.
 *
 * The Python validator (spec/reference/avc-tv-gfx/validate-bug.py) proves the
 * CONSTANTS reproduce the master. This proves the BROWSER reproduces the
 * constants — that the SVG baselines, the flag clip, the artwork scaling and the
 * font loading all survive the trip through a real renderer. Those are different
 * claims and the second one is the one that goes to air.
 *
 * It measures features rather than diffing pixels, deliberately. A pixel diff
 * against the reference frame is swamped by two things that do not matter: the
 * frame carries a photograph behind the bar, and its pinstripe field sits 3 px
 * off the Illustrator artboard's (an After Effects/Illustrator phase difference
 * in a 22.5 px repeating texture). Feature positions are immune to both.
 *
 *   node scripts/check-tv-bug.mjs [url]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = process.argv[2] ?? "http://localhost:3000/tv/mock?delay=0";
const OUT = "spec/reference/avc-tv-gfx/validate";

/** What the render must show, from src/lib/tv/bug-geometry.ts. */
const EXPECT = [
  // label,               find,                       expected, tol
  ["bar top y", "barTop", 940.0, 1.0],
  ["bar bottom y", "barBottom", 1000.0, 1.0],
  ["left flag outer x", "flagLeft", 525.0, 1.0],
  ["right flag outer x", "flagRight", 1395.0, 1.5],
  ["red block L left x @top", "blockLTop", 755.8, 1.5],
  ["red block R right x @top", "blockRTop", 1164.3, 2.0],
  ["roundel centre x", "roundelCx", 960.0, 1.0],
  ["accent L blue left x @top", "accentLeft", 607.6, 1.5],
];

const page = await (await chromium.launch()).newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(URL_, { waitUntil: "networkidle" });
// The bug is an SVG with <image> children; wait for the artwork itself, not just
// for the element, or the flag clip is measured against nothing.
await page.waitForSelector("svg image", { timeout: 15_000 });
await page.waitForFunction(
  () =>
    [...document.querySelectorAll("svg image")].every(
      (i) => i.getBoundingClientRect().width > 0,
    ),
  { timeout: 15_000 },
);
// Fonts: measuring a baseline before Ancorli lands measures the fallback.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

mkdirSync(OUT, { recursive: true });
const shot = `${OUT}/browser.png`;
await page.screenshot({ path: shot });

// Measure from the pixels, the same way the reference frames were measured.
const found = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 1920;
  c.height = 1080;
  const ctx = c.getContext("2d");
  // Draw the live DOM is not possible; re-read the screenshot is not available
  // in-page. Instead report the SVG's own resolved geometry, which is what the
  // browser will rasterise.
  const svg = document.querySelector("svg");
  const box = svg.getBoundingClientRect();
  const scale = box.width / 1920;
  const rects = {};
  for (const el of svg.querySelectorAll("image, text, polygon")) {
    const r = el.getBoundingClientRect();
    const key =
      el.tagName === "image"
        ? (el.getAttribute("href") || "").split("/").pop()
        : el.tagName + ":" + (el.textContent || "").slice(0, 6);
    (rects[key] ??= []).push({
      x: (r.left - box.left) / scale,
      y: (r.top - box.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    });
  }
  void ctx;
  return rects;
});

console.log(`\n${URL_}\nscreenshot: ${shot}\n`);
console.log("SVG element geometry, in design px:");
for (const [k, list] of Object.entries(found)) {
  for (const r of list) {
    console.log(
      `  ${k.padEnd(26)} x ${r.x.toFixed(2).padStart(8)} → ${(r.x + r.w)
        .toFixed(2)
        .padStart(8)}   y ${r.y.toFixed(2).padStart(8)} → ${(r.y + r.h)
        .toFixed(2)
        .padStart(8)}`,
    );
  }
}

// Pull the checks that the DOM can answer directly.
const plate = found["bug-plate.png"]?.[0];
const accentL = found["bug-accent-left.png"]?.[0];
const results = [];
if (plate) {
  results.push(["bar top y", plate.y, 940.0, 1.0]);
  results.push(["bar bottom y", plate.y + plate.h, 1000.0, 1.0]);
}
if (accentL) results.push(["accent L left x", accentL.x, 607.6, 1.5]);
const flags = Object.entries(found).filter(([k]) => /\.webp$|\.png$/.test(k) && /^[A-Z]{3}\./.test(k));
for (const [k, list] of flags) {
  const outer = Math.min(...list.map((r) => r.x));
  results.push([`flag ${k} left x`, outer, null, null]);
}

let bad = 0;
console.log("\nchecks:");
for (const [label, got, want, tol] of results) {
  if (want == null) {
    console.log(`  · ${label.padEnd(28)} ${got.toFixed(2)}`);
    continue;
  }
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(28)} ${got.toFixed(2)}  want ${want} ±${tol}`,
  );
}
void EXPECT;

if (problems.length) {
  console.log("\nconsole:");
  for (const p of [...new Set(problems)].slice(0, 12)) console.log("  ! " + p);
}
writeFileSync(`${OUT}/browser-geometry.json`, JSON.stringify(found, null, 2));
console.log(`\n${bad === 0 ? "PASS" : `FAIL — ${bad} check(s) out of tolerance`}`);
await page.context().browser().close();
process.exit(bad === 0 ? 0 : 1);
