/**
 * PDF text extraction for the golden fixtures (spec/30 Phase G).
 *
 * spec/29's goldens asserted a byte count and the MediaBox — enough to catch a
 * renderer that throws or emits a blank page, and nothing else. A layout or
 * wording regression sailed straight through, which is the failure mode
 * goldens exist for.
 *
 * Test-only, so `pdfjs-dist` stays a dev dependency and never reaches the app
 * bundle. The legacy build is the one that runs under Node without a DOM.
 */
export interface TextItem {
  /** The rendered string, trimmed. Empty items are dropped. */
  str: string;
  /** Page coordinates, rounded — see `roundTo` for why. */
  x: number;
  y: number;
  page: number;
}

/**
 * Positions are rounded to whole points.
 *
 * Sub-point differences are invisible on paper and would make a snapshot churn
 * on any pdfkit patch release. A whole point is finer than any layout change
 * worth catching is coarse.
 */
function roundTo(n: number): number {
  return Math.round(n);
}

/** Extract every non-empty text item from a rendered PDF, in reading order. */
export async function extractTextItems(pdf: Buffer): Promise<TextItem[]> {
  // Imported lazily and by path: the legacy ESM build is the Node-safe one.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
    // Silence the worker: everything runs in-process under vitest.
    disableFontFace: true,
  }).promise;

  const out: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[] };
      const str = (it.str ?? "").trim();
      if (!str) continue;
      const t = it.transform ?? [0, 0, 0, 0, 0, 0];
      out.push({ str, x: roundTo(t[4]), y: roundTo(t[5]), page: p });
    }
  }
  await doc.cleanup();
  return out;
}

/** Just the strings, for vocabulary comparisons that ignore position. */
export async function extractText(pdf: Buffer): Promise<string[]> {
  return (await extractTextItems(pdf)).map((i) => i.str);
}

/**
 * A stable, diffable snapshot: text plus position, sorted so the order does not
 * depend on the order pdfkit happened to emit drawing operations in.
 */
export async function textSnapshot(pdf: Buffer): Promise<string[]> {
  const items = await extractTextItems(pdf);
  return items
    .map((i) => `p${i.page} @${i.x},${i.y} ${i.str}`)
    .sort((a, b) => a.localeCompare(b));
}
