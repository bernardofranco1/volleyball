// Regenerates src/lib/vis-live/mock.ts from the captured fixture (spec/35 W9).
// The XML is embedded in the module because the mock must work in the bundle
// with no filesystem access, and must never reach VIS.
import { readFileSync, writeFileSync } from "node:fs";

const xml = readFileSync("src/__tests__/fixtures/vis/volley-live-mock-21546.xml", "utf-8");
const existing = readFileSync("src/lib/vis-live/mock.ts", "utf-8");
const updated = existing.replace(
  /const CAPTURED_XML = [\s\S]*?;\n/,
  `const CAPTURED_XML = ${JSON.stringify(xml)};\n`,
);
writeFileSync("src/lib/vis-live/mock.ts", updated);
console.log("mock.ts regenerated from fixture");
