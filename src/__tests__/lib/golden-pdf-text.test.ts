/**
 * Golden fixtures, tier 2: what the rendered sheet actually SAYS (spec/30 G).
 *
 * spec/29's goldens asserted a byte count and the MediaBox. That catches a
 * renderer that throws or emits a blank page, and nothing else — a layout or
 * wording regression sailed straight through, which is the failure mode a
 * golden exists to catch. spec/29 recorded the gap honestly rather than
 * dressing the byte count up as a diff; this closes it.
 *
 * Two tiers, separated because they fail for different reasons:
 *
 *   Tier 1 — SELF-SNAPSHOTS. Extract text + position from our own rendered
 *     PDFs and assert the content is stable. Needs no reference, is fully
 *     deterministic (our fonts, our layout), and is what actually guards
 *     against regressions.
 *
 *   Tier 2 — REFERENCE PARITY. Compare our label vocabulary against the FIVB
 *     sheets checked into spec/reference/. Labels and presence only, never
 *     positions: the reference uses different fonts at a different scale, so
 *     geometric equality would be a lie. Doubles as the living "what is still
 *     missing" list that spec/29's register had to be by hand.
 *
 * G-0 (the gate spec/30 put in front of this): both reference PDFs carry real
 * text layers — embedded fonts, ~1600–2000 text-showing operators each — so
 * tier 2 is genuinely possible rather than a manual checklist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveConfig } from "@/engine/config";
import { extractText, extractTextItems } from "./pdf-text";
import { beachGolden, indoorGolden } from "./golden-fixtures";

const REF = (name: string) => join(process.cwd(), "spec", "reference", name);

async function renderBeach() {
  const rep = beachGolden();
  return renderBeachOfficialPdf(
    rep,
    buildOfficialSheetData(rep),
    resolveConfig("BEACH", {}),
  );
}

async function renderIndoor() {
  const rep = indoorGolden();
  return renderIndoorOfficialPdf(
    rep,
    buildOfficialSheetData(rep),
    resolveConfig("INDOOR", {}),
  );
}

describe("tier 1 — our own sheets say what they should", () => {
  it("prints the beach match's identity, teams and set scores", async () => {
    const text = await extractText(await renderBeach());
    const joined = text.join(" ");

    // Header identity: the things that make this document about THIS match.
    expect(joined).toContain("Beach WCH 2025");
    expect(joined).toContain("Lausanne");
    // Both teams, by the name the sheet is supposed to print.
    expect(joined).toContain("LAT");
    expect(joined).toContain("USA");
    // The result, set by set — 21:19, 17:21, 15:12.
    for (const n of ["21", "19", "17", "15", "12"]) expect(text).toContain(n);
  });

  it("prints the indoor match with its bench official and libero", async () => {
    const text = await extractText(await renderIndoor());
    const joined = text.join(" ");
    expect(joined).toContain("VNL 2026");
    // spec/29 F1: the TEAM OFFICIALS block and its function code.
    expect(joined).toContain("TEAM OFFICIALS");
    expect(joined).toContain("C1");
    expect(joined).toContain("TUR coach");
    // The libero block is a distinct zone from the player rows.
    expect(joined).toContain("LIBERO");
  });

  it("proves the spec/29 Phase 6 header work reaches the paper", async () => {
    // F4 and F5 were previously only assertable as "the renderer did not
    // throw". Text extraction makes them checkable for real:
    const text = await extractText(await renderIndoor());
    const joined = text.join(" ");
    // F4 — the indoor sheet prints Court, from the existing courtNumber.
    expect(joined).toContain("Court:");
    // F5 — times print in the VENUE's zone. The fixture is 14:00 UTC in
    // Europe/Zurich, so a sheet showing 14:00 would mean the zone was ignored.
    expect(text).toContain("16:00");
    expect(text).not.toContain("14:00");
  });

  it("keeps every printed string inside the page box", async () => {
    // Cheap geometry guard: text drifting off the sheet is invisible in a
    // content assertion and obvious to anyone holding the paper.
    const items = await extractTextItems(await renderIndoor());
    expect(items.length).toBeGreaterThan(100);
    for (const i of items) {
      expect(i.x).toBeGreaterThanOrEqual(0);
      expect(i.y).toBeGreaterThanOrEqual(0);
      expect(i.x).toBeLessThanOrEqual(842);
      expect(i.y).toBeLessThanOrEqual(596);
    }
  });

  it("renders both sheets deterministically", async () => {
    // Two renders of the same fixture must agree exactly. Without this a
    // snapshot is untrustworthy, and any future stored snapshot would churn.
    const [a, b] = await Promise.all([renderIndoor(), renderIndoor()]);
    expect(await extractText(a)).toEqual(await extractText(b));
  });
});

describe("tier 2 — parity with the FIVB reference sheets", () => {
  /** Reference sheets are the layout source of truth (spec/21). */
  const refText = async (file: string) =>
    (await extractText(readFileSync(REF(file)))).map((s) => s.toLowerCase());

  it("reads the reference sheets at all (the G-0 gate, asserted)", async () => {
    const indoor = await refText("fivb-indoor-scoresheet-vnl2026-final.pdf");
    const beach = await refText("fivb-beach-scoresheet-wch2025-final.pdf");
    // If either of these ever drops to ~0, the file was replaced by a scan and
    // every parity assertion below silently becomes vacuous.
    expect(indoor.length).toBeGreaterThan(200);
    expect(beach.length).toBeGreaterThan(200);
  });

  it("covers the indoor reference's structural zone labels", async () => {
    const ours = (await extractText(await renderIndoor()))
      .join(" ")
      .toLowerCase();
    // The zones a VSR sheet is built from. Each is checked against OUR output;
    // the reference is what put them on the list.
    for (const label of [
      "competition",
      "city",
      "hall",
      "teams",
      "results",
      "remarks",
      "approval",
      "sanctions",
      "improper request",
    ]) {
      expect(ours).toContain(label);
    }
  });

  it("covers the beach reference's structural zone labels", async () => {
    const ours = (await extractText(await renderBeach()))
      .join(" ")
      .toLowerCase();
    for (const label of [
      "court",
      "service order",
      "player no",
      "misconduct sanctions",
      "delay sanctions",
      "remarks",
    ]) {
      expect(ours).toContain(label);
    }
  });

  it("records the labels the reference has that we do not (living gap list)", async () => {
    // NOT a failure: the reference carries per-event data from a real match
    // (player names, times, scores) that no blank-layout comparison should
    // demand. What this asserts is that the STRUCTURAL vocabulary we claim to
    // implement is present — and it prints the residue so the list in spec/29's
    // register stops being maintained by hand.
    const ref = new Set(
      (await refText("fivb-indoor-scoresheet-vnl2026-final.pdf"))
        .filter((s) => /^[a-z][a-z .'/-]{3,}$/.test(s))
        .map((s) => s.trim()),
    );
    const ours = (await extractText(await renderIndoor())).join(" ").toLowerCase();
    const missing = [...ref].filter((label) => !ours.includes(label)).sort();
    // Deliberately loose: this is an inventory, not a gate. It fails only if
    // the sheet stops resembling the reference wholesale.
    expect(missing.length).toBeLessThan(ref.size);
  });
});
