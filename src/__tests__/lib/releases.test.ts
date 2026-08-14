import { describe, expect, it } from "vitest";
import { migrationVerdict } from "@/lib/releases";

// The promotion gate (spec/28 §7). `required` is the CANDIDATE's own migration
// count, read from its /api/version — the console's bundled count is its own
// build's, and the two differ precisely when the answer matters.

describe("migrationVerdict", () => {
  describe("promoting", () => {
    const promote = (required: number | null, applied: number | null) =>
      migrationVerdict({ required, applied, action: "PROMOTE" });

    it("allows a build whose migrations production has already run", () => {
      expect(promote(19, 19)).toEqual({ ok: true, warning: null });
    });

    it("refuses a build that needs migrations production has not run", () => {
      // The 11 Aug incident: production on commit A, promoting commit B which
      // adds 0020. The old guard compared the CONSOLE's journal (also 19) and
      // computed nothing pending, so it waved this through.
      const v = promote(20, 19);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.error).toContain("expects 20");
        expect(v.error).toContain("applied 19");
        expect(v.error).toContain("db:migrate:prod");
      }
    });

    it("allows a build older than production's schema", () => {
      // Additive migrations: production is ahead, the build asks for less.
      expect(promote(18, 19)).toEqual({ ok: true, warning: null });
    });

    it("refuses when the candidate did not report its count", () => {
      const v = promote(null, 19);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("did not report");
    });

    it("refuses when production's count could not be read", () => {
      // Never treated as zero: that used to read as "everything is pending".
      const v = promote(20, null);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("could not be read");
    });
  });

  describe("rolling back", () => {
    const rollback = (required: number | null, applied: number | null) =>
      migrationVerdict({ required, applied, action: "ROLLBACK" });

    it("allows the ordinary case — an older build, production ahead", () => {
      // The old guard blocked this outright, telling the operator to migrate
      // production FORWARD while production was broken.
      expect(rollback(18, 19)).toEqual({ ok: true, warning: null });
    });

    it("proceeds with a warning when a count is unknown", () => {
      // Recovery must not be blocked by a number that could not be read.
      const v = rollback(null, 19);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.warning).toContain("without verifying migrations");
    });

    it("proceeds with a warning when production's count is unknown", () => {
      const v = rollback(18, null);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.warning).toContain("without verifying migrations");
    });

    it("still refuses a target needing migrations that are not applied", () => {
      // Unknown is forgiven; known-bad is not, in either direction.
      expect(rollback(20, 19).ok).toBe(false);
    });
  });
});
