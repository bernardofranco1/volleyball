/**
 * The REMARKS composer (spec/29 Phase 4).
 *
 * The scoresheet's REMARKS block is where everything without a pre-printed
 * cell gets written down. Composing those lines from typed events — instead of
 * letting each renderer format its own — is what keeps the sheet a
 * deterministic rendering of the log, and what makes the block scannable: one
 * shape, `Set n — what, score (detail)`.
 */
import { describe, expect, it } from "vitest";
import { remark } from "@/lib/scoresheet/remarks";

const ctx = {
  setNumber: 2,
  score: { a: 14, b: 11 },
  team: "A" as const,
  member: "7",
  name: "Rossi",
};

describe("remark lines", () => {
  it("always leads with the set and the score at the moment", () => {
    // A referee reading the block must be able to place every line in the match
    // without cross-referencing anything else.
    for (const line of [
      remark.exceptionalSubstitution(ctx, "12 Bianchi"),
      remark.recovery(ctx),
      remark.liberoRedesignation(ctx, "5 Verdi"),
      remark.setDefault(ctx),
      remark.positionalFault(ctx, "ROTATION"),
      remark.protest(ctx, "net height"),
    ]) {
      expect(line).toMatch(/^Set 2 — /);
      expect(line).toContain("14:11");
    }
  });

  it("names the player when known, and stays clean when not", () => {
    expect(remark.recovery(ctx)).toContain("7 Rossi");
    const anonymous = remark.recovery({ setNumber: 1, score: { a: 0, b: 0 } });
    expect(anonymous).toBe("Set 1 — medical recovery, 0:0");
    // No dangling separators or empty parentheses when there is nothing to add.
    expect(anonymous).not.toMatch(/\(\)|;\s*$|,\s*$/);
  });

  it("counts repeat recoveries for the same player", () => {
    expect(remark.recovery(ctx, 1)).not.toContain("#");
    expect(remark.recovery(ctx, 2)).toContain("#2 for this player");
  });

  it("says which team RECEIVED a defaulted set, not just who lost it", () => {
    // The line has to be unambiguous on its own — "team A incomplete" alone
    // reads as if A were awarded something.
    expect(remark.setDefault({ ...ctx, team: "A" })).toContain("to team B");
    expect(remark.setDefault({ ...ctx, team: "B" })).toContain("to team A");
  });

  it("distinguishes the two positional faults", () => {
    expect(remark.positionalFault(ctx, "ROTATION")).toContain("rotation fault");
    expect(remark.positionalFault(ctx, "SERVICE_ORDER")).toContain(
      "service order fault",
    );
  });

  it("records how many points a fault correction cancelled, and why", () => {
    const line = remark.faultCorrection(ctx, 3, "wrong server since 9:8");
    expect(line).toContain("3 point(s) cancelled");
    expect(line).toContain("wrong server since 9:8");
  });

  it("separates a retirement from a forfeit", () => {
    expect(remark.forfeit(ctx, "RETIREMENT")).toContain("retirement");
    expect(remark.forfeit(ctx, "FORFEIT")).toContain("forfeit");
  });

  it("carries an exceptional substitution's two players", () => {
    const line = remark.exceptionalSubstitution(ctx, "12 Bianchi");
    expect(line).toContain("out 7 Rossi");
    expect(line).toContain("in 12 Bianchi");
  });
});
