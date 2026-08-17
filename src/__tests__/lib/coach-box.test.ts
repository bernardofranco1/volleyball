/**
 * The coach box on the official scoresheets (spec/21 G4, spec/24 §2.5).
 *
 * Rewritten by the spec/31 test-suite audit. The original technique — render
 * the same match with and without a coach and require the bytes to differ —
 * predates PDF text extraction and could only prove the value was CONSUMED,
 * not what it became; any incidental byte difference would also have passed.
 * With extraction the assertion is the real one: the coach's NAME is printed
 * on the paper. Stronger, and half the renders (two instead of four).
 */
import { describe, expect, it } from "vitest";
import type { MatchReportData } from "@/lib/match-report";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderBeachOfficialPdf } from "@/lib/scoresheet/beach-official";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveConfig } from "@/engine/config";
import { extractText } from "./pdf-text";
import { report } from "./golden-fixtures";

const COACH_A = "Zé Roberto Guimarães";
const COACH_B = "Julio Velasco";

function withCoaches(discipline: "BEACH" | "INDOOR"): MatchReportData {
  return report(discipline, [], { coachA: COACH_A, coachB: COACH_B });
}

describe("coach names reach the paper", () => {
  it("beach: the coach row prints the assigned head coach", async () => {
    const rep = withCoaches("BEACH");
    const pdf = await renderBeachOfficialPdf(
      rep,
      buildOfficialSheetData(rep),
      resolveConfig("BEACH", {}),
    );
    const text = (await extractText(pdf)).join(" ");
    // The renderer truncates to its cell width — assert the visible prefix.
    expect(text).toContain(COACH_A.slice(0, 20));
  });

  it("indoor: the TEAMS block prints both coaches", async () => {
    const rep = withCoaches("INDOOR");
    const pdf = await renderIndoorOfficialPdf(
      rep,
      buildOfficialSheetData(rep),
      resolveConfig("INDOOR", {}),
    );
    const text = (await extractText(pdf)).join(" ");
    expect(text).toContain(COACH_A.slice(0, 20));
    expect(text).toContain(COACH_B.slice(0, 20));
  });
});
